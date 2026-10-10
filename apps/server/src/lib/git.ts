import {
  Scheduler,
  analyzeUpdates,
  getLog,
  getRepoStatus,
  getRepoStatuses,
  pullRepo,
  readReadme,
  readRemoteUrl,
  readRepoFacts,
  scanDirectory,
  type RepoFacts,
  type RepoStatus,
  type ScanResult,
} from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import { readSettings } from './settings.ts'
import { lastUpstreamSha } from '../repos/updates.ts'

export { analyzeUpdates, getLog, getRepoStatus, pullRepo, readReadme }
export { README_MAX_BYTES, README_FULL_MAX_BYTES } from '@git-nest/core'
export type { UpdateReport } from '@git-nest/core/git'

/**
 * git 层在 server 侧的统一入口。
 *
 * 超时与并发上限来自设置表（可在设置页改），所以每次调用现读一次——
 * 本地工具，没有值得缓存的东西。
 */

/**
 * 同仓库串行、跨仓库并发上限可动态调整。
 *
 * **全局只有这一个实例，所有入口都必须把 `scheduler` 传下去。**
 * `Scheduler` 的同仓库队列（chains）是实例私有的，所以任何绕过它、直接调 core
 * 同名函数（于是落到 core 的 `defaultScheduler`）的地方，都等于绕过了
 * 「同仓库串行」——批量 `pull --ff-only` 正在写工作区时，同一个仓库的
 * `git status` / `rev-list` 会并发跑，正是核心不变量 3 要防的 index.lock / refs 竞争。
 * 顺带一提，core 的默认实例并发写死 4，设置页的 concurrency 对它无效。
 */
let scheduler = new Scheduler({ concurrency: 4 })

/** 换一个 scheduler 实例（测试注入用）。 */
export function useScheduler(next: Scheduler): void {
  scheduler = next
  scheduler.setLimit(current().concurrency)
}

/** 状态短缓存：列表页一次要问十几个仓库，同一次渲染不该重复跑 git */
const STATUS_TTL_MS = 3_000

/**
 * 列表页的缓存单独一份，**不能**和详情页共用。
 *
 * 两档读的东西不一样：lean 档的 `dirty` 恒为 false、`lastCommit` 恒为 null
 * （列表页根本不显示它们）。要是混进同一个 Map，详情页在 3 秒窗口内就会拿到
 * 一份「没有脏标记」的状态——而脏标记正是 `pull` 的安全闸。宁可多存一份，
 * 也不要一个会骗人的缓存。
 *
 * lean 档本身足够便宜，TTL 给短一点，列表数字更新得更快。
 */
const LEAN_TTL_MS = 1_500
const statusCache = new Map<string, { at: number; value: RepoStatus }>()
const leanCache = new Map<string, { at: number; value: RepoStatus }>()

let db: DB | null = null

export function bindSettings(database: DB): void {
  db = database
  scheduler.setLimit(readSettings(database).concurrency)
}

function current() {
  if (!db) return { gitTimeoutMs: 120_000, concurrency: 4 }
  return readSettings(db)
}

/** 单仓库的完整状态（详情页、pull 前置检查用）。带脏标记与最后提交，**不便宜**。 */
export async function repoStatus(
  path: string,
  options: { fresh?: boolean; projectId?: number } = {},
): Promise<RepoStatus> {
  const { gitTimeoutMs } = current()
  scheduler.setLimit(current().concurrency)

  // 上次检查时上游指向哪 —— full 档算「推不推荐更新」要用它判「作者改写历史」。
  // 读不出来（没查过、或旧记录没这个字段）就当没有：宁可判不出，不要瞎判。
  const lastSha =
    options.projectId !== undefined && db ? lastUpstreamSha(db, options.projectId) : null
  const read = () =>
    getRepoStatus(path, {
      timeoutMs: gitTimeoutMs,
      scheduler,
      profile: 'full',
      lastUpstreamSha: lastSha,
      label: 'status',
    })

  if (options.fresh) {
    statusCache.delete(path)
    return read()
  }
  const hit = statusCache.get(path)
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value

  const value = await read()
  statusCache.set(path, { at: Date.now(), value })
  return value
}

/**
 * 列表页的批量状态：**lean 档**。
 *
 * 列表那一列只画分支、↑↓ 和一句话状态，不显示未提交改动、也不显示最后提交
 * （`StatusCell` 里那两处都是详情页才用）。所以这里不读工作区、不读对象，
 * 每仓库只剩 1 条 git 命令（算 ahead/behind），其余走 pure-JS 的 isomorphic-git。
 *
 * 返回的 `dirty` / `dirtyCount` / `lastCommit` **没有意义**，别拿去判安全性——
 * 要那个就调 `repoStatus`（full 档）。
 */
export async function repoStatusesLean(paths: string[]): Promise<RepoStatus[]> {
  const { gitTimeoutMs, concurrency } = current()
  scheduler.setLimit(concurrency)

  const now = Date.now()
  const fresh = paths.filter((p) => {
    const hit = leanCache.get(p)
    return !(hit && now - hit.at < LEAN_TTL_MS)
  })
  if (fresh.length > 0) {
    const results = await getRepoStatuses(fresh, {
      timeoutMs: gitTimeoutMs,
      scheduler,
      profile: 'lean',
    })
    for (const status of results) leanCache.set(status.path, { at: Date.now(), value: status })
  }

  return paths.map((p) => leanCache.get(p)?.value ?? unreadableStatus(p))
}

/** 缓存被清掉、又来不及重查时的兜底状态：说清「没读出来」，而不是崩掉。 */
function unreadableStatus(path: string): RepoStatus {
  return {
    path,
    checkedAt: new Date().toISOString(),
    isRepo: false,
    branch: null,
    detached: false,
    dirty: false,
    dirtyCount: 0,
    dirtyTracked: 0,
    dirtyUntracked: 0,
    upstream: null,
    upstreamGone: false,
    ahead: null,
    behind: null,
    remoteUrl: null,
    lastCommit: null,
    recommendation: null,
    status: 'error',
    error: { kind: 'unknown', message: '状态没读出来，重试一次' },
  }
}

/**
 * 读完状态想知道「刚才那条路要拉什么」时用这个。
 *
 * `lastUpstreamSha` 由调用方从 `update_checks` 历史里读出来传进来——
 * 那是判「作者有没有改写上游历史」的**唯一**依据（见 core 的 `inspect/recommend.ts`）。
 * core 不认识数据库，所以这个事实必须由 server 侧提供。
 *
 * `onStart` 在**真正拿到并发许可、开始跑**的那一刻回调：批量检查一次把几百个仓库
 * 交出去，界面上不该在那一刻就把几百行标成「检查中」。
 */
export function analyze(
  path: string,
  options: { lastUpstreamSha?: string | null; label?: string; onStart?: () => void } = {},
) {
  const { gitTimeoutMs } = current()
  return analyzeUpdates(path, {
    timeoutMs: gitTimeoutMs,
    scheduler,
    lastUpstreamSha: options.lastUpstreamSha ?? null,
    label: options.label ?? 'check',
    ...(options.onStart ? { onStart: options.onStart } : {}),
  })
}

/**
 * 唯一的更新入口（`--ff-only`）。
 *
 * `lastUpstreamSha` 传下去，pull 就会在动手前先 fetch + 比基线：调用方手上那道闸
 * 读的是**上次检查的结论**，而「检查」到「点更新」之间作者可能刚好 force push
 * ——那正是「本地看不出被改写、git 自己会安静快进」的场景。基线必须在 fetch 之前读，
 * 所以这一步得由 pull 自己（先 fetch、再比、最后才动工作区）做。
 */
export function pull(path: string, lastUpstreamSha: string | null = null) {
  const { gitTimeoutMs } = current()
  return pullRepo(path, { timeoutMs: gitTimeoutMs, scheduler, lastUpstreamSha })
}

/**
 * 当前分支的提交记录。
 *
 * 一阶段界面不再显示提交图（见 `routes/git.ts` 里 `/log` 的注释），但这个取数
 * 留着：二阶段 Agent 解析仓库时要用，且测试已覆盖。留着不等于要显示。
 */
export function repoLog(path: string, max: number, branch = 'HEAD') {
  const { gitTimeoutMs } = current()
  return getLog(path, { maxCount: max, branch, timeoutMs: gitTimeoutMs, scheduler })
}

/**
 * 扫目录：同样必须走这一个 scheduler，否则扫描会绕开并发上限。
 * `maxResults` 由调用方（路由）显式给，值来自 core 的 `MAX_SCAN_RESULTS`。
 */
export function scan(
  dir: string,
  options: { maxDepth?: number; maxResults?: number; trackedPaths?: Iterable<string> },
): Promise<ScanResult> {
  const { gitTimeoutMs } = current()
  return scanDirectory(dir, {
    maxDepth: options.maxDepth,
    maxResults: options.maxResults,
    trackedPaths: options.trackedPaths,
    timeoutMs: gitTimeoutMs,
    scheduler,
  })
}

/**
 * 读 origin 地址（`git remote get-url origin` = **git 真正会用的那个地址**，
 * 会套用 `url.<base>.insteadOf`；扫描预览、添加项目、批量导入三处统一用它，
 * 所以预览里看到的地址就是入库后那条记录的地址）。
 *
 * 排队**只在这一层做**：调用 core 的**纯实现** `readRemoteUrl`，而不是那个自带
 * `scheduler.schedule` 的外壳 `getRemoteUrl` —— 两处都排队就是「同一个 key 的
 * schedule 里再 schedule」，直接自锁。core 那边现在已经把这两件事拆成两个函数，
 * 这条约定不再靠「谁忘了传 scheduler」来维持。
 */
export function getRemoteUrl(path: string): Promise<string | null> {
  const { gitTimeoutMs } = current()
  return scheduler.schedule(path, () => readRemoteUrl(path, { timeoutMs: gitTimeoutMs }))
}

/**
 * 只读仓库元信息（分支 / HEAD / 上游 / origin 地址）：走 isomorphic-git，**一条
 * git 进程都不起**（实测 0.5–3ms）。
 *
 * 给「只想知道是不是仓库、当前分支叫什么」的调用方用——那两条本来就在这份事实里，
 * 没必要为此跑一次完整状态读取（`/projects/:id/log` 原来就是这么干的：
 * full + fresh 档，3–4 条进程只为两个字段）。
 */
export function repoFacts(path: string): Promise<RepoFacts> {
  const { gitTimeoutMs } = current()
  return scheduler.schedule(path, () => readRepoFacts(path, { timeoutMs: gitTimeoutMs }))
}

export function clearStatusCache(): void {
  statusCache.clear()
  leanCache.clear()
}
