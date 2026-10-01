import {
  Scheduler,
  analyzeUpdates,
  getLog,
  getRemoteUrl as coreGetRemoteUrl,
  getRepoStatus,
  getRepoStatuses,
  pullRepo,
  scanDirectory,
  type RepoStatus,
  type ScanResult,
} from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import { readSettings } from './settings.ts'

export { analyzeUpdates, getLog, getRepoStatus, getRepoStatuses, pullRepo }
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

export function currentScheduler(): Scheduler {
  return scheduler
}

/** 状态短缓存：列表页一次要问十几个仓库，同一次渲染不该重复跑 git */
const STATUS_TTL_MS = 3_000
const statusCache = new Map<string, { at: number; value: RepoStatus }>()

let db: DB | null = null

export function bindSettings(database: DB): void {
  db = database
  scheduler.setLimit(readSettings(database).concurrency)
}

function current() {
  if (!db) return { gitTimeoutMs: 120_000, concurrency: 4 }
  return readSettings(db)
}

export async function repoStatus(
  path: string,
  options: { fresh?: boolean } = {},
): Promise<RepoStatus> {
  const { gitTimeoutMs } = current()
  scheduler.setLimit(current().concurrency)

  if (options.fresh) {
    statusCache.delete(path)
    return getRepoStatus(path, { timeoutMs: gitTimeoutMs, scheduler })
  }
  const hit = statusCache.get(path)
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value

  const value = await getRepoStatus(path, { timeoutMs: gitTimeoutMs, scheduler })
  statusCache.set(path, { at: Date.now(), value })
  return value
}

export async function repoStatuses(paths: string[]): Promise<RepoStatus[]> {
  const { gitTimeoutMs, concurrency } = current()
  scheduler.setLimit(concurrency)

  const now = Date.now()
  const fresh = paths.filter((p) => {
    const hit = statusCache.get(p)
    return !(hit && now - hit.at < STATUS_TTL_MS)
  })
  if (fresh.length > 0) {
    // 注意：这里 await 期间缓存可能被 clearStatusCache() 清掉（改设置、改/删项目、
    // 批量任务收尾都会清），所以下面回填时不能再假设「刚才命中的那些还在」。
    const results = await getRepoStatuses(fresh, { timeoutMs: gitTimeoutMs, scheduler })
    for (const status of results) statusCache.set(status.path, { at: Date.now(), value: status })
  }

  return paths.map((p) => statusCache.get(p)?.value ?? unreadableStatus(p))
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
    upstream: null,
    upstreamGone: false,
    ahead: null,
    behind: null,
    remoteUrl: null,
    lastCommit: null,
    status: 'error',
    error: { kind: 'unknown', message: '状态没读出来，重试一次' },
  }
}

/** 读完状态想知道「刚才那条路要拉什么」时用这个 */
export function analyze(path: string) {
  const { gitTimeoutMs } = current()
  return analyzeUpdates(path, { timeoutMs: gitTimeoutMs, scheduler })
}

export function pull(path: string) {
  const { gitTimeoutMs } = current()
  return pullRepo(path, { timeoutMs: gitTimeoutMs, scheduler })
}

export function repoLog(path: string, max: number, branch = 'HEAD') {
  const { gitTimeoutMs } = current()
  return getLog(path, { maxCount: max, branch, timeoutMs: gitTimeoutMs, scheduler })
}

/** 扫目录：同样必须走这一个 scheduler，否则扫描会绕开并发上限。 */
export function scan(dir: string, options: { maxDepth?: number; trackedPaths?: Iterable<string> }): Promise<ScanResult> {
  const { gitTimeoutMs } = current()
  return scanDirectory(dir, {
    maxDepth: options.maxDepth,
    trackedPaths: options.trackedPaths,
    timeoutMs: gitTimeoutMs,
    scheduler,
  })
}

/**
 * 只读 origin 地址。也要走这一个 scheduler 与设置里的超时：
 * 它读的是同一个仓库的配置，不该在别人 pull 的时候插进去并发跑。
 */
export function getRemoteUrl(path: string): Promise<string | null> {
  const { gitTimeoutMs } = current()
  return scheduler.schedule(path, () => coreGetRemoteUrl(path, { timeoutMs: gitTimeoutMs }))
}

export function clearStatusCache(): void {
  statusCache.clear()
}
