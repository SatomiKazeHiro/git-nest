/**
 * 传输层类型：server 与 web 共用。
 *
 * 约定：对外一律用 camelCase；本地绝对路径（path）只出现在 server 内部与本机响应里，
 * 绝不写入任何会被提交或分享的文件。
 */
import type { UpdateStatus } from './git/types.ts'

/** git 层的状态类型在这里也转出去，前后端只认一份定义。 */
export type {
  UpdateStatus,
  GitErrorKind,
  GitError,
  GitCommitRef,
  RepoStatus,
  GitLogEntry,
  ScannedRepo,
  ScanResult,
  UpdateReport,
  UpdateReportEntry,
  PullOutcome,
  PullResult,
} from './git/types.ts'

/** 项目分类是自由字符串，不做枚举；这五个只是初始值。 */
export const INITIAL_CATEGORIES = [
  'personal',
  'knowledge-base',
  'backups',
  'experiments',
  'tools',
] as const

export type InitialCategory = (typeof INITIAL_CATEGORIES)[number]

export interface Tag {
  id: number
  name: string
  color: string | null
}

export interface Note {
  id: number
  projectId: number
  content: string
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: number
  name: string
  /** 本地绝对路径，正斜杠 */
  path: string
  remoteUrl: string | null
  category: string
  sourceUrl: string | null
  summary: string | null
  addedAt: string
  sortOrder: number
}

/** update_checks.status 的取值见 git/types.ts 的 UpdateStatus（同一份定义）。 */
export interface UpdateCheck {
  id: number
  projectId: number
  checkedAt: string
  status: UpdateStatus
  aheadCount: number | null
  behindCount: number | null
  detail: string | null
}

/** 列表页需要的最小检查摘要，M1 恒为 null（无 git 层）。 */
export interface UpdateCheckSummary {
  checkedAt: string
  status: UpdateStatus
  aheadCount: number | null
  behindCount: number | null
}

/** 能作为「问过远程」依据的状态（与 isRemoteCheckStatus 同一份定义）。 */
export const REMOTE_CHECK_STATUSES = ['up_to_date', 'behind', 'ahead', 'diverged'] as const

/**
 * 这次检查能不能当作「最近一次成功问过远程」的依据？
 *
 * 只有真正问到远程结论的四种状态算数。其余都不算：
 * - `error`：fetch 失败（断网 / 私有仓库 / 超时），本地 refs 根本没更新
 * - `missing` / `not_a_repo`：压根不是仓库，没有远程可言
 * - `no_remote` / `no_upstream`：没有可问的远程
 * - `dirty` / `detached` / `no_commits`：这是**调用方状态**，不是远程结论
 *   （`deriveStatus` 里 dirty / detached 的优先级高于 ahead/behind，所以一次
 *   检查在脏工作区上会得到 `dirty` 而不是 `behind` —— 干净工作区仍是 `behind`，
 *   不会因此漏报「有更新」；但这行记录不该冒充「问过远程」）
 *
 * 为什么较真：界面上「新鲜度」用的是 `latestCheck.checkedAt`。如果失败的检查
 * 也能刷新它，那断网之后点一次「检查更新」，清单页反而会显示**今天刚确认过的
 * 绿色「已是最新」** —— 正是设计文档第 13 节第 10 条要消灭的「没有依据的肯定」。
 */
export function isRemoteCheckStatus(status: UpdateStatus): boolean {
  return (REMOTE_CHECK_STATUSES as readonly UpdateStatus[]).includes(status)
}

/**
 * 状态机的输入。
 *
 * 放在这里（浏览器安全的 barrel）而不是 git 层，是因为**前端也要用同一份**：
 * 详情页摘要要让「跟远程差多少」当主角、把脏标记降级成旁边一句，
 * 那就得自己按同一套优先级重算一遍结论。两处各写一份必然飘开。
 */
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
  /**
   * 跳过脏标记这一档。**只有「没有读工作区」的调用方才能传 true**。
   *
   * 两个真实的调用方：
   * - 清单页（读状态走 lean 档，不读工作区）—— 那里压根没有脏的依据
   * - 详情页摘要 —— 它有脏的数据，但主角要让给「跟远程差多少」
   *
   * 传 true 是把前提写明，而不是依赖 `dirty` 恰好是 false。
   */
  skipDirty?: boolean
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
  if (!input.skipDirty && input.dirty) return 'dirty'
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

/** 列表页的一行：项目 + tag + 最近一次检查摘要 + 备注条数。 */
export interface ProjectListItem extends Project {
  tags: Tag[]
  latestCheck: UpdateCheckSummary | null
  notesCount: number
}

export interface ProjectDetail extends ProjectListItem {
  notes: Note[]
}

export interface ProjectFilters {
  category?: string
  tag?: string
  q?: string
}

/** 错误响应统一形状。 */
export interface ApiErrorBody {
  code: string
  message: string
  issues?: { path: string; message: string }[]
}
