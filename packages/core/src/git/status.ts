import fs from 'node:fs'
import { toGitError, probe, runGit, DEFAULT_TIMEOUT_MS } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import type { GitCommitRef, RepoStatus, UpdateStatus } from './types.ts'

export interface StatusOptions {
  timeoutMs?: number
  scheduler?: Scheduler
}

const EMPTY = (path: string, status: UpdateStatus): RepoStatus => ({
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
  status,
  error: null,
})

/**
 * 仓库实时状态：分支、脏标记、ahead/behind、最后提交时间。
 *
 * 注意 ahead/behind 只反映「上一次 fetch 之后」的事实——它不会自己去联网。
 * 想要最新的数字必须先 fetch，那是 analyzeUpdates（M3）的事。
 */
export async function getRepoStatus(path: string, options: StatusOptions = {}): Promise<RepoStatus> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.schedule(path, () => readStatus(path, options.timeoutMs))
}

async function readStatus(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RepoStatus> {
  if (!fs.existsSync(path)) {
    return { ...EMPTY(path, 'missing'), error: { kind: 'missing', message: '目录不在了' } }
  }
  if (path.length > 240 && process.platform === 'win32') {
    // Windows 的 MAX_PATH 约 260 字符；git 自己进不去，早点说清比让它报
    // 「Filename too long」强得多
    return {
      ...EMPTY(path, 'error'),
      error: {
        kind: 'path_too_long',
        message: `路径 ${path.length} 个字符，超过 Windows 的长度上限（约 260 字符），git 进不去`,
      },
    }
  }

  const cwd = { cwd: path, timeoutMs }
  const base = EMPTY(path, 'error')

  // 1. 是不是仓库
  const inside = await probe(['rev-parse', '--is-inside-work-tree'], cwd)
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    // 这条失败有多种可能：真的不是仓库，也可能是路径太长 / 进不去。
    // 直接说「不是仓库」会把用户引向错误的方向，所以把真实原因归因后透出。
    const err = toGitError(inside.ok ? { code: 1, stdout: '', stderr: '', timedOut: false } : inside.result, '这个目录不是 git 仓库')
    if (err.kind === 'not_a_repo') {
      return { ...base, status: 'not_a_repo', error: err }
    }
    return { ...base, status: 'error', error: err }
  }

  // 2. 脏标记（porcelain 稳定，不受 locale 影响）
  const porcelain = await probe(['status', '--porcelain'], cwd)
  const dirtyLines = porcelain.ok ? porcelain.stdout.split('\n').filter((l) => l.trim()) : []
  const dirty = dirtyLines.length > 0

  // 3. 有没有提交（空仓库没有 HEAD，后面所有比较都没意义）
  const hasCommits = (await probe(['rev-parse', '--verify', '-q', 'HEAD'], cwd)).ok

  // 4. 分支 / detached HEAD —— 退出码非零是预期结果，不是失败
  const head = await probe(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
  const branch = head.ok ? head.stdout.trim() : null
  const detached = !head.ok && hasCommits

  // 5. 上游 —— 同样，非零退出只意味着「没有上游」
  const upstreamRef = await probe(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    cwd,
  )
  let upstream: string | null = upstreamRef.ok ? upstreamRef.stdout.trim() : null

  // 6. ahead / behind，依赖上游
  let ahead: number | null = null
  let behind: number | null = null
  let upstreamGone = false
  if (upstream && hasCommits) {
    const counts = await probe(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], cwd)
    if (counts.ok) {
      const [left, right] = counts.stdout.trim().split(/\s+/).map((n) => Number(n))
      ahead = left ?? null
      behind = right ?? null
    } else {
      upstreamGone = /no such|unknown revision|bad revision|gone/i.test(counts.result.stderr)
      if (upstreamGone) upstream = null
    }
  }

  // 7. 远程地址
  const remote = await probe(['remote', 'get-url', 'origin'], cwd)
  const remoteUrl = remote.ok ? remote.stdout.trim() : null

  // 8. 最后一次提交
  const lastCommit = hasCommits ? await readLastCommit(cwd) : null

  const status = deriveStatus({
    isRepo: true,
    dirty,
    detached,
    hasCommits: lastCommit !== null,    upstream: upstream !== null,
    ahead,
    behind,
    upstreamGone,
    hasRemote: remoteUrl !== null,
  })

  return {
    ...base,
    isRepo: true,
    branch,
    detached,
    dirty,
    dirtyCount: dirtyLines.length,
    upstream,
    upstreamGone,
    ahead,
    behind,
    remoteUrl,
    lastCommit,
    status,
    error: null,
  }
}

export interface DeriveInput {
  isRepo: boolean
  dirty: boolean
  detached: boolean
  hasCommits: boolean
  upstream: boolean
  ahead: number | null
  behind: number | null
  upstreamGone: boolean
  hasRemote: boolean
}

/**
 * 状态机。注意：这些不是异常分支，是仓库的常态——
 * 「没有上游」「detached HEAD」「远程分支已删」都是正常存在的情况。
 *
 * 优先级从上到下，先命中的赢。排在前面的都是「更本地、更当下」的事实：
 * 先说你工作区没提交，再说你没有上游——后者才是下一步要去修的东西。
 */
export function deriveStatus(input: DeriveInput): UpdateStatus {
  if (!input.isRepo) return 'not_a_repo'
  if (!input.hasCommits) return 'no_commits'
  if (input.dirty) return 'dirty'
  if (input.detached) return 'detached'
  if (input.upstreamGone) return 'no_upstream'
  if (!input.upstream) return input.hasRemote ? 'no_upstream' : 'no_remote'

  const ahead = input.ahead ?? 0
  const behind = input.behind ?? 0
  if (ahead > 0 && behind > 0) return 'diverged'
  if (behind > 0) return 'behind'
  if (ahead > 0) return 'ahead'
  return 'up_to_date'
}

async function readLastCommit(cwd: {
  cwd: string
  timeoutMs?: number
}): Promise<GitCommitRef | null> {
  const result = await probe(
    ['log', '-1', '--no-merges', '--format=%h%x1f%s%x1f%an%x1f%cI'],
    cwd,
  )
  if (!result.ok) return null
  const [shortHash, subject, author, date] = result.stdout.trim().split('\x1f')
  if (!shortHash) return null
  return {
    hash: shortHash,
    subject: subject ?? '',
    author: author ?? '',
    date: date ?? '',
  }
}

/**
 * 只读 origin 地址。清单里的 remote_url 在添加项目时用它自动填。
 *
 * 接受 `timeoutMs` / `scheduler`：调用方（server）要让它受设置里的超时约束，
 * 并且和同一个仓库的其它操作共用一把锁。
 */
export async function getRemoteUrl(
  path: string,
  options: { timeoutMs?: number; scheduler?: Scheduler } = {},
): Promise<string | null> {
  const task = async () => {
    const result = await probe(['remote', 'get-url', 'origin'], {
      cwd: path,
      timeoutMs: options.timeoutMs,
    })
    return result.ok ? result.stdout.trim() : null
  }
  const scheduler = options.scheduler
  return scheduler ? scheduler.schedule(path, task) : task()
}

/** 批量查状态：跨仓库并发受 scheduler 限制，同仓库自动串行。 */
export async function getRepoStatuses(
  paths: string[],
  options: StatusOptions = {},
): Promise<RepoStatus[]> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.map(paths, (p) => p, (p) => readStatus(p, options.timeoutMs))
}

/** 供 UI 直接显示的一句话说明。 */
export function describeStatus(status: RepoStatus): string {
  switch (status.status) {
    case 'up_to_date':
      return '已是最新'
    case 'ahead':
      return `领先远程 ${status.ahead ?? 0} 个提交`
    case 'behind':
      return `落后远程 ${status.behind ?? 0} 个提交`
    case 'diverged':
      return `分叉：领先 ${status.ahead ?? 0}、落后 ${status.behind ?? 0}`
    case 'dirty':
      return `工作区有 ${status.dirtyCount} 处未提交改动`
    case 'no_upstream':
      return '当前分支没有上游'
    case 'detached':
      return 'HEAD 处于游离状态'
    case 'no_remote':
      return '没有配置远程'
    case 'no_commits':
      return '仓库还没有提交'
    case 'missing':
      return '目录不在了'
    case 'not_a_repo':
      return '不是 git 仓库'
    default:
      return status.error?.message ?? '状态未知'
  }
}

export { toGitError, runGit }
