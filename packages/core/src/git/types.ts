/** git 层的类型。纯数据结构，不依赖 HTTP / UI，server 与未来的 Agent 都能直接用。 */

import type { UpdateRecommendation } from '../types.ts'

export type { UpdateRecommendation, UpdateVerdict } from '../types.ts'

export type UpdateStatus =
  | 'up_to_date'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'dirty'
  | 'no_upstream'
  /** 上游分支已被远程删掉（git 的 upstream:track 报 [gone]） */
  | 'gone'
  | 'detached'
  | 'no_remote'
  | 'error'
  | 'missing'
  | 'not_a_repo'
  | 'no_commits'

/** 失败归因，决定 UI 给什么可操作的提示。 */
export type GitErrorKind =
  | 'missing'
  | 'not_a_repo'
  /** Windows 路径超过 MAX_PATH，git 进不去 */
  | 'path_too_long'
  | 'timeout'
  | 'auth'
  | 'network'
  | 'locked'
  | 'unknown'

export interface GitError {
  kind: GitErrorKind
  message: string
  /** 归因依据的原始 stderr，便于排查 */
  raw?: string
}

export interface GitCommitRef {
  hash: string
  subject: string
  author: string
  date: string
}

export interface RepoStatus {
  path: string
  checkedAt: string
  /** 目录存在且是 git 仓库 */
  isRepo: boolean
  /** 当前分支；detached 时为 null */
  branch: string | null
  detached: boolean
  /** 工作区或暂存区有改动 */
  dirty: boolean
  /** porcelain 输出行数：改动文件数（含未跟踪） */
  dirtyCount: number
  /**
   * 改动里「已跟踪文件被改」的数量。**这些才是更新真会踩到的东西。**
   * 只有 full 档读得到，lean 档恒为 0（那边不读工作区）。
   */
  dirtyTracked: number
  /**
   * 改动里「未跟踪新文件」的数量。绝大多数是构建产物、`.venv`、下载的数据。
   * 只有 full 档读得到，lean 档恒为 0。
   */
  dirtyUntracked: number
  upstream: string | null
  /** 上游分支已被远程删除 */
  upstreamGone: boolean
  ahead: number | null
  behind: number | null
  remoteUrl: string | null
  lastCommit: GitCommitRef | null
  /**
   * 推不推荐更新。**只有 full 档才读**（要问「能不能快进」，是几次进程；
   * 而且它必须先知道有没有共同祖先，那是本地 refs 就够，不必联网）。
   *
   * `lean` 档下恒为 null——清单页的推荐不从这里来，而是从**上次检查**的结果里读
   * （见 `UpdateCheckSummary.recommendation` 的注释）。
   */
  recommendation: UpdateRecommendation | null
  status: UpdateStatus
  error: GitError | null
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** committer date（ISO） */
  date: string
  /** 提交图组件要的 committer / author 时间戳 */
  committerDate: string
  authorDate: string
  /** 这个提交属于哪条分支（本视图只看一条线，所以是当前分支名） */
  branch: string
  subject: string
  /** HEAD / main / origin/main / tag: v1.0 之类，逗号分隔的来源 */
  refs: string[]
}

export interface UpdateReportEntry {
  shortHash: string
  subject: string
  author: string
  date: string
}

/** 一次检查更新的结果：fetch 之后本地与远程的差异。 */
export interface UpdateReport {
  status: UpdateStatus
  /** 本地有、远程没有的提交数（还没推上去的） */
  ahead: number | null
  /** 远程有、本地没有的提交数（要拉进来的） */
  behind: number | null
  outgoing: UpdateReportEntry[]
  /** 远程有、本地没有的提交 */
  incoming: UpdateReportEntry[]
  /** fetch 之后新出现的本地 tag */
  tags: string[]
  /**
   * 推不推荐更新。**这是这个软件一阶段最要紧的一条输出**：
   * 它回答「拉了会不会出事」，而不只是「落后几个提交」。
   * 见 `inspect/recommend.ts`。
   */
  recommendation: UpdateRecommendation | null
  /**
   * 这次看到的上游 SHA。要落库，下次检查时拿它判「作者有没有改写历史」——
   * 那是 `rewritten` 唯一的判据（见 `recommend.ts` 文件头的限制说明）。
   */
  upstreamSha: string | null
  error: GitError | null
}

/** 一次更新（pull --ff-only）的结果。 */
export type PullOutcome = 'updated' | 'already_up_to_date' | 'skipped' | 'failed'

export interface PullResult {
  outcome: PullOutcome
  /** 本次快进了几个提交 */
  newCommits: number
  status: UpdateStatus
  /** 被跳过时给用户的理由（中文，可直接显示） */
  reason: string | null
  error: GitError | null
  /** 给结果表直接显示的一句话 */
  summary: string
}

export interface ScannedRepo {
  dir: string
  name: string
  remoteUrl: string | null
  summary: string | null
  /** README 首段来自哪里：readme / commit / none */
  summarySource: 'readme' | 'commit' | 'none'
  alreadyTracked: boolean
}

export interface ScanResult {
  dir: string
  found: ScannedRepo[]
}
