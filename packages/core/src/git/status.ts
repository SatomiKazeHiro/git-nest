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
  // 早退的门槛刻意比 Windows 的 MAX_PATH（约 260）保守一截。
  // 实测：258 字符的目录**存在**，但 `git -C <它>` 直接 exit 128
  // （`fatal: cannot change to ...: No such file or directory`），
  // 带上 `core.longpaths=true` 也一样 —— 那个选项救不了最初的 chdir。
  // 与其让 git 报一句看不懂的 ENOENT，不如自己先说清怎么办。
  if (path.length > 240 && process.platform === 'win32') {
    return {
      ...EMPTY(path, 'error'),
      error: {
        kind: 'path_too_long',
        message: `路径 ${path.length} 个字符，git 进不去（Windows 上超过约 240 字符就会失败，core.longpaths 也救不了最初的目录切换）。把仓库移到浅一点的目录，或者开启系统的长路径支持（LongPathsEnabled）`,
      },
    }
  }

  const cwd = { cwd: path, timeoutMs }
  const base = EMPTY(path, 'error')

  // 1. 一次拿到「是不是仓库 + 脏标记 + 分支 + 上游 + 领先/落后」。
  //
  // 以前这里要跑 5–6 条独立命令：先 `rev-parse --is-inside-work-tree` 判是不是仓库，
  // 再 `status --porcelain` / `rev-parse --verify HEAD` / `symbolic-ref` /
  // 上游的 `for-each-ref` / `rev-list --left-right`。Windows 上每条 git 命令几百
  // 毫秒，一个仓库七八条就是几秒钟 —— 100 个仓库约 800 次进程启动。
  //
  // `--porcelain=v2 --branch` 一次就够：失败时的报错本身也能区分「不是仓库」
  // （`fatal: not a git repository`）与「路径进不去」（`cannot change to`），
  // 所以连那句预检都不必单独跑。头几行的含义：
  //
  //   # branch.oid <sha> | (initial)          → 有没有提交
  //   # branch.head <名字> | (detached)       → 分支 / detached
  //   # branch.upstream <上游>                → 有上游才有这一行
  //   # branch.ab +<领先> -<落后>              → 上游还能解析出来才有这一行
  //   其余行                                   → 工作区改动（脏）
  //
  // 注意「有 upstream 行但没有 ab 行」＝ 上游被远程删了（prune 之后就是这形态），
  // 这正是 gone 的判据；实测确认过，比再跑一次 for-each-ref 省一条命令。
  const porcelain = await probe(['status', '--porcelain=v2', '--branch'], cwd)
  if (!porcelain.ok) {
    // 失败有多种可能：不是仓库、路径太长进不去、或者仓库坏了。
    // 直接说「不是仓库」会把人引向错误的方向，所以按 git 的真实报错归因。
    const err = toGitError(porcelain.result, '这个目录不是 git 仓库')
    if (err.kind === 'not_a_repo') {
      return { ...base, status: 'not_a_repo', error: err }
    }
    return { ...base, status: 'error', error: err }
  }

  const parsed = parsePorcelainV2(porcelain.stdout)
  const hasCommits = parsed.oid !== null
  const branch = parsed.branch
  const detached = parsed.detached
  const dirtyLines = parsed.changes
  const dirty = dirtyLines.length > 0

  // 上游：行在但 ab 不在 = 已被远程删掉
  const upstreamName = parsed.upstreamGone ? null : parsed.upstream
  const upstreamGone = parsed.upstreamGone
  const ahead = parsed.ahead
  const behind = parsed.behind

  // 3. 远程地址
  const remote = await probe(['remote', 'get-url', 'origin'], cwd)
  const remoteUrl = remote.ok ? remote.stdout.trim() : null

  // 4. 最后一次提交
  const lastCommit = hasCommits ? await readLastCommit(cwd) : null

  const status = deriveStatus({
    isRepo: true,
    dirty,
    detached,
    hasCommits: hasCommits && lastCommit !== null,
    upstream: upstreamName !== null,
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
    upstream: upstreamName,
    upstreamGone,
    ahead,
    behind,
    remoteUrl,
    lastCommit,
    status,
    error: null,
  }
}

interface PorcelainV2 {
  /** 提交存在时是 sha，空仓库是 null */
  oid: string | null
  branch: string | null
  detached: boolean
  upstream: string | null
  /** 有 upstream 行、但没有 ab 行 = 上游被远程删了 */
  upstreamGone: boolean
  ahead: number | null
  behind: number | null
  /** 非头部的行（工作区改动） */
  changes: string[]
}

/** 解析 `git status --porcelain=v2 --branch`。头部的 `#` 行给元信息，其余行是改动。 */
export function parsePorcelainV2(raw: string): PorcelainV2 {
  const out: PorcelainV2 = {
    oid: null,
    branch: null,
    detached: false,
    upstream: null,
    upstreamGone: false,
    ahead: null,
    behind: null,
    changes: [],
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  let hasAb = false

  for (const line of lines) {
    if (line.startsWith('# branch.oid ')) {
      const value = line.slice('# branch.oid '.length).trim()
      // 空仓库是 `(initial)`
      out.oid = value === '(initial)' ? null : value
      continue
    }
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      if (value === '(detached)') {
        out.detached = true
        out.branch = null
      } else {
        out.branch = value
      }
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      out.upstream = line.slice('# branch.upstream '.length).trim()
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const m = line.slice('# branch.ab '.length).trim().match(/^\+(\d+)\s+-(\d+)$/)
      if (m) {
        out.ahead = Number(m[1])
        out.behind = Number(m[2])
        hasAb = true
      }
      continue
    }
    if (line.startsWith('#')) continue // 其它头部（branch.ab 之外）
    out.changes.push(line)
  }

  // 有上游、但 git 没能给出领先/落后 → 上游引用已经不在了
  if (out.upstream !== null && !hasAb) out.upstreamGone = true

  return out
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
  // 「上游被远程删了」要单独说：它的下一步动作和「从来没配过上游」完全不同
  // （前者重新 push -u 或删掉本地分支，后者才需要设上游）
  if (input.upstreamGone) return 'gone'
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
    case 'gone':
      return '上游分支已被远程删掉'
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
