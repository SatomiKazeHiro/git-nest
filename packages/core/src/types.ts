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
