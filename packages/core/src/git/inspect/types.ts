/**
 * 仓库事实的读取契约。
 *
 * 这里只放「事实的形状」，不放任何读取实现——实现分两家：
 * - `via-lib.ts`：isomorphic-git（纯 JS）。**只读 ref 与 config**，不 spawn 进程。
 *   列表页要看的十几个仓库全靠它，省掉每仓库一次 git.exe 启动（Windows 上约 70ms）。
 * - `via-cli.ts`：真 git。工作区（脏标记）、ahead/behind、以及一切写操作。
 *   这些要么必须与 git 逐字节一致（脏标记是 pull 的安全闸），要么库算起来更慢。
 *
 * **每条事实只有一个提供方**，不搞「谁快用谁」的运行时择优——那种代码分支多、
 * 两套结果不一致时没人说得清该信谁。
 */

/** 是不是仓库、HEAD 指向哪、上游配没配。全是读 ref/config 就能拿到的事实。 */
export interface RepoFacts {
  isRepo: boolean
  /** 当前分支短名；detached 与「仓库还没提交」两种情况都是 null */
  branch: string | null
  detached: boolean
  /** 仓库里有没有提交（HEAD 能解析出对象） */
  hasCommits: boolean
  /** 配置里配了上游（`upstream: null` 与 `upstreamGone: true` 的区别就在这里） */
  upstream: string | null
  /** 配置里的上游引用解析不出来 → 上游分支已被远程删掉 */
  upstreamGone: boolean
  remoteUrl: string | null
  /** 读取失败时的原因；非 null 时其余字段都不可信 */
  error: GitFactsError | null
}

export interface GitFactsError {
  kind: 'missing' | 'not_a_repo' | 'path_too_long' | 'unknown'
  message: string
}

/** 工作区事实。只有真 git 能给，而且**脏标记是 pull 的安全闸，必须准**。 */
export interface WorktreeFacts {
  dirty: boolean
  /** 改动文件数（含未跟踪） */
  changeCount: number
}

/** ahead/behind 与「上游是不是真的没了」。 */
export interface DivergenceFacts {
  ahead: number | null
  behind: number | null
  /** 配置里确实有上游、但引用解析不出来 = 上游被远程删了 */
  upstreamGone: boolean
}

/**
 * 读 ahead/behind 时需要的**前置事实**。
 *
 * `rev-list HEAD...@{u}` 失败时，git 的报错分不出「压根没配上游」和「配了但引用不在」——
 * 两种都是 `unknown revision or path not in the working tree`。所以「有没有配上游」
 * 必须由 `RepoFacts` 提供（那是库读 config 拿到的），CLI 这边只负责在
 * **已知配了上游**的前提下判断「它还在不在」。这就是「每条事实只有一个提供方」的实际形态。
 */
export interface DivergenceInput {
  upstream: string | null
}

export interface CommitFacts {
  hash: string
  subject: string
  author: string
  date: string
}

/**
 * 「推不推荐更新」的类型定义在 `../../types.ts`（浏览器安全的 barrel）：
 * 清单页要显示它，而它随检查结果落库、由列表接口读出来。
 * 这里原样转出，让 git 层的调用方仍然只 import 一处。
 *
 * 判据的实现在 `recommend.ts`——那里的文件头写了完整语义与一个诚实的限制。
 */
export type { UpdateRecommendation, UpdateVerdict } from '../../types.ts'

/** 读仓库元信息（ref/config）。**不 spawn 进程**。 */
export type RepoInspector = (path: string, options: InspectOptions) => Promise<RepoFacts>

/** 读工作区（脏标记）。只服务详情页与 pull 的前置检查。 */
export type WorktreeInspector = (
  path: string,
  options: InspectOptions,
) => Promise<WorktreeFacts | null>

/** 读领先/落后。需要走提交图，交给真 git。 */
export type DivergenceInspector = (
  path: string,
  options: InspectOptions,
  input: DivergenceInput,
) => Promise<DivergenceFacts | null>

/** 读最后一次提交。只有详情页要。 */
export type CommitInspector = (
  path: string,
  options: InspectOptions,
) => Promise<CommitFacts | null>

export interface InspectOptions {
  timeoutMs?: number
}
