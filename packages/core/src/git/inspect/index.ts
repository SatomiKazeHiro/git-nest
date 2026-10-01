/**
 * 仓库状态读取的唯一入口。两条路，按「要读什么」选，不按「谁快」选：
 *
 * | 档位 | 读什么 | 进程 | 谁用 |
 * |---|---|---|---|
 * | `lean` | ref/config + ahead/behind | 每仓库 1 次 git | 列表页（十几个仓库一屏） |
 * | `full` | 上面全部 + 工作区 + 最后提交 | 每仓库 3 次 git | 详情页、pull 前置检查 |
 *
 * 差别就是「脏标记」和「最后提交」这两条：前者要遍历工作区，后者要读对象，
 * 都很贵；而列表页那一列根本不显示它们（`StatusCell` 只画分支、↑↓、一句话状态），
 * 详情页才需要 dirty / dirtyCount / lastCommit。
 *
 * 列表页以前也走 full，100 个仓库要 7.8 秒——里面大半是在算没人看的两个字段。
 */

import fs from 'node:fs'
import { defaultScheduler, type Scheduler } from '../scheduler.ts'
import { deriveStatus, type DeriveInput } from '../status.ts'
import type { GitError, RepoStatus } from '../types.ts'
import { readRepoFacts } from './via-lib.ts'
import { readDivergence, readLastCommit, readWorktree } from './via-cli.ts'
import type { GitFactsError, InspectOptions } from './types.ts'

export type { RepoFacts, WorktreeFacts, DivergenceFacts, CommitFacts } from './types.ts'

/**
 * 读多少。
 * - `lean`：列表页。不碰工作区、不读最后提交，所以 `dirty` 恒为 false、
 *   `dirtyCount` 恒为 0、`lastCommit` 恒为 null。**这三个字段在 lean 下没有意义，
 *   别拿去判断安全性**（要判安全性就调 `readRepoStatus`，也就是 full）。
 * - `full`：默认档，行为与改造前逐字节一致。
 */
export type StatusProfile = 'lean' | 'full'

export interface ReadStatusOptions extends InspectOptions {
  scheduler?: Scheduler
  profile?: StatusProfile
}

/**
 * 门槛可以提前拦掉，就不必起进程再解释一遍 git 的报错。
 *
 * 240 这个数字刻意比 Windows 的 MAX_PATH（约 260）保守一截：实测 258 字符的目录
 * **存在**，但 `git -C <它>` 直接 exit 128（`fatal: cannot change to ...`），
 * 带上 `core.longpaths=true` 也一样——那个选项救不了最初的 chdir。
 *
 * 注意这一条**不能**因为「库读 ref 不需要 chdir」就放宽：ahead/behind 仍然要真 git，
 * 仓库有上游时照样会卡在这里，那还不如一开始就说清楚。
 */
function pathTooLong(path: string): boolean {
  return path.length > 240 && process.platform === 'win32'
}

function blank(path: string): RepoStatus {
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
    error: null,
  }
}

/** 读不出来时**绝不**落到「干净 / 已是最新」那一侧。 */
function unreadable(path: string, error: GitError): RepoStatus {
  return { ...blank(path), status: error.kind === 'missing' ? 'missing' : 'error', error }
}

/** 目录不存在 / 路径过长：不起进程就知道，也不必等 git 报一句看不懂的错。 */
async function gate(path: string): Promise<RepoStatus | null> {
  if (pathTooLong(path)) {
    return unreadable(path, {
      kind: 'path_too_long',
      message: `路径 ${path.length} 个字符，git 进不去（Windows 上超过约 240 字符就会失败，core.longpaths 也救不了最初的目录切换）。把仓库移到浅一点的目录，或者开启系统的长路径支持（LongPathsEnabled）`,
    })
  }
  const exists = await fs.promises
    .stat(path)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    return unreadable(path, { kind: 'missing', message: '目录不在了' })
  }
  return null
}

function factsError(path: string, err: GitFactsError): RepoStatus {
  if (err.kind === 'missing') return unreadable(path, { kind: 'missing', message: err.message })
  if (err.kind === 'not_a_repo') {
    return { ...unreadable(path, { kind: 'not_a_repo', message: err.message }), status: 'not_a_repo' }
  }
  return unreadable(path, { kind: 'unknown', message: err.message })
}

/**
 * 「上游没了」的最终结论，来自两处**不同**的证据，任一成立就是：
 * - 库：配置里的上游引用解析不出来（`fetch --prune` 之后的常态）
 * - CLI：已知配了上游、但 `rev-list HEAD...@{u}` 解析不出来
 *   （连「引用在、对象从没 fetch 过」也一并覆盖）
 */
function upstreamIsGone(factsGone: boolean, divergenceGone: boolean): boolean {
  return factsGone || divergenceGone
}

async function inspect(path: string, options: ReadStatusOptions): Promise<RepoStatus> {
  const profile: StatusProfile = options.profile ?? 'full'
  const early = await gate(path)
  if (early) return early

  const facts = await readRepoFacts(path, options)
  if (facts.error) return factsError(path, facts.error)

  const base = blank(path)
  const common = {
    ...base,
    isRepo: true,
    branch: facts.branch,
    detached: facts.detached,
    upstream: facts.upstream,
    remoteUrl: facts.remoteUrl,
    error: null,
  }

  // ahead/behind：库不提供（要走提交图），这一条永远是真 git。
  // 把「有没有配上游」这个已知事实递进去，CLI 才能把「没配」和「配了但没了」分开。
  const divergence = facts.hasCommits
    ? await readDivergence(path, options, { upstream: facts.upstream })
    : null
  const upstreamGone = upstreamIsGone(facts.upstreamGone, divergence?.upstreamGone ?? false)

  // 工作区与最后提交：只有 full 档才付这份代价。
  const worktree = profile === 'full' ? await readWorktree(path, options) : null
  const lastCommit =
    profile === 'full' && facts.hasCommits ? await readLastCommit(path, options) : null

  // 脏标记读不出来时，**不能**当作「干净」往下走：pull 会据此决定要不要动工作区。
  if (profile === 'full' && facts.hasCommits && worktree === null) {
    return unreadable(path, { kind: 'unknown', message: '读不出工作区状态，不敢判它干不干净' })
  }

  const dirty = worktree?.dirty ?? false
  const derive: DeriveInput = {
    isRepo: true,
    dirty,
    detached: facts.detached,
    // 「有提交」以「最后提交读出来了」为准（改造前的口径）：HEAD 在但 log 失败
    // （仓库坏、或引用悬空）时应当报错，而不是嘴硬说 up_to_date。
    hasCommits: facts.hasCommits && (profile === 'lean' || lastCommit !== null),
    upstream: facts.upstream !== null && !upstreamGone,
    ahead: upstreamGone ? null : (divergence?.ahead ?? null),
    behind: upstreamGone ? null : (divergence?.behind ?? null),
    upstreamGone,
    hasRemote: facts.remoteUrl !== null,
  }

  return {
    ...common,
    isRepo: true,
    dirty,
    dirtyCount: worktree?.changeCount ?? 0,
    upstreamGone,
    ahead: derive.ahead,
    behind: derive.behind,
    lastCommit: lastCommit
      ? { hash: lastCommit.hash, subject: lastCommit.subject, author: lastCommit.author, date: lastCommit.date }
      : null,
    status: deriveStatus(derive),
  }
}

/**
 * 读一个仓库的状态。同仓库串行、跨仓库并发受 scheduler 限制
 * （列表页一次问十几个仓库，靠的就是它）。
 */
export async function readRepoStatus(
  path: string,
  options: ReadStatusOptions = {},
): Promise<RepoStatus> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.schedule(path, () => inspect(path, options))
}

/** 批量读。同一个 scheduler，所以跨仓库并发上限与设置页一致。 */
export async function readRepoStatuses(
  paths: string[],
  options: ReadStatusOptions = {},
): Promise<RepoStatus[]> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.map(
    paths,
    (p) => p,
    (p) => inspect(p, options),
  )
}
