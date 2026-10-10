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

/**
 * 项目分类：**枚举**。
 *
 * 原来是自由文本 + 五个建议值（`personal` / `knowledge-base` / `backups` /
 * `experiments` / `tools`）。改成枚举的理由：
 *
 * 1. **`personal` 已经不该是分类。** 「是不是我自己的」现在是 `projects.is_own`
 *    那个勾选框。分类里再留一个 personal，是把同一件事记在一个**没有任何行为**
 *    的地方——而且以前填了它**真的**会被批量检查跳过，现在不会了。凭记忆填的人
 *    会看到分类里明明写着 personal，却没拿到期待的行为：那正是我们花了几轮
 *    拆掉的静默失效。
 * 2. 自由文本会出 `backup` / `backups`、`试验` / `experiments` 这类近似重复，
 *    分组时看着像多了一个组。
 * 3. 枚举里的每一项都有确定的中文名，`categoryLabel()` 从「部分覆盖」变成全覆盖。
 *
 * **加一个分类就是改这一个常量**（前后端共用），这是有意的：现在不留「将来
 * 可能要自定义」的口子，等真的需要时再拆。
 */
export const CATEGORIES = ['knowledge-base', 'backups', 'experiments', 'tools'] as const

/**
 * 能存进数据库的全部取值。**空串就是「未分类」**——它必须在里面：
 * 大部分项目一开始都没有分类（扫描导入的一律留空）。
 */
export const CATEGORY_VALUES = ['', ...CATEGORIES] as const

/**
 * 分类的**显示名**。键是存进数据库的字面值，值是界面上给人看的中文。
 *
 * **只翻显示，不翻数据。** 存进库的永远是 `backups` / `experiments` 这些英文，
 * 筛选、分组、排序全读原始值。
 *
 * 枚举之后这张表是**全覆盖**的：不在 `CATEGORY_VALUES` 里的值进不了库，
 * 所以「查不到就原样显示」这条退路只是防脏数据，不是常规路径。
 */
export const CATEGORY_LABELS: Record<string, string> = {
  '': '未分类',
  'knowledge-base': '知识库',
  backups: '备份',
  experiments: '试验',
  tools: '工具',
}

/**
 * 界面上显示的分类名。库里没有的值原样返回——那说明有脏数据，
 * 换成「未知分类」之类的说法只会让人以为自己填错了。
 */
export function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value
}

export interface Tag {
  id: number
  name: string
  color: string | null
}

export interface Project {
  id: number
  name: string
  /** 本地绝对路径，正斜杠 */
  path: string
  remoteUrl: string | null
  /**
   * 这是你自己写的项目吗？
   *
   * 批量检查默认跳过它们（设置里的「自己的项目也参与检查」可以打开）——
   * 自己的项目自己清楚，没必要让它们去联网问远程。
   *
   * **它曾经是「分类正好等于 personal」**，一条挂在自由文本上的隐藏规则：
   * 写成 `Personal`、多打空格或写成中文就静默失效，界面上没有任何提示。
   * 一个只有布尔含义的东西就该用布尔来存，规则不该挂在人会拼错的字符串上。
   * 分类因此回归纯标签：只管分组与筛选。
   */
  isOwn: boolean
  category: string
  /**
   * 你自己写的那一段：怎么找到这个项目的、对它的想法。链接随手写在里面。
   *
   * **只有一个字段**。原来拆成「摘要 + 来源链接 + 备注列表」三样，三样错在同一处：
   * 按一份手写 Markdown 清单的行内写法建模（一条 bullet 一句话一个链接），
   * 而不是按人怎么记东西建模。摘要能从 README 读出来就不该存；来源链接只有
   * 一个格子，写不下「B 站 → 视频里提到的仓库 → GitHub」那一串；备注列表是
   * 「流」（N 条、各自时间戳），而人要的是「文档」（一处、持续改）。
   */
  record: string
  addedAt: string
  sortOrder: number
}

/**
 * 「推不推荐更新」的判据。
 *
 * 这是这个软件一阶段最要紧的一件事：**在拉之前就告诉用户会不会出事**。
 * 四种情况要分开说，因为下一步动作完全不同：
 *
 * | verdict | 什么情况 | 该说什么 |
 * |---|---|---|
 * | `safe` | 本地 HEAD 是上游的祖先 | 能快进，放心拉 |
 * | `diverged` | 两边都有提交，但有共同祖先 | 真分叉，要你自己决定 |
 * | `rewritten` | 上次见过的上游提交**不再是**上游的祖先 | 作者 force push 了，别直接拉 |
 * | `unrelated` | 两个历史**没有共同祖先** | 这多半是作者重置/重建了仓库，拉等于换一个仓库 |
 *
 * `unrelated` 就是用户点名要防的那个情况（"避免更新到作者删库或者重置仓库"）。
 * 定义放在这个浏览器安全的 barrel 里，因为清单页要显示它（它是随检查结果落库的）。
 */
export type UpdateVerdict = 'safe' | 'diverged' | 'rewritten' | 'unrelated' | 'gone' | 'no_upstream'

export interface UpdateRecommendation {
  verdict: UpdateVerdict
  /** 本地有、上游没有的提交数 */
  ahead: number | null
  /** 上游有、本地没有的提交数 */
  behind: number | null
  /** 能不能直接拉：只有 safe 且确实落后时才是 true */
  canPull: boolean
  /** 给人看的一句话（中文，可直接显示） */
  reason: string
}

/**
 * 各判决的固定说法。放在这里（而不是只在 `recommend.ts` 里）是因为
 * **结论要落库、之后要能原样重建**：`update_checks.detail` 只存 `verdict` 这个短码，
 * 清单页读出来之后需要用它拼回完整的话。两处各写一份必然飘开。
 */
export const VERDICT_REASON: Record<UpdateVerdict, string> = {
  safe: '可以直接快进。',
  diverged: '上游和本地都往前走了，不能快进，需要你自己决定怎么合。',
  rewritten:
    '上游历史被改写过（上次见过的那个提交已经不在远程分支上了，作者可能 force push 或回退了）。直接拉会分叉或失败，先确认作者为什么改，必要时先备份本地改动。',
  unrelated:
    '本地和远程的历史没有共同祖先——这不是「更新」，是换了一个仓库（作者多半删库重建过，或者把历史整个替换了）。强烈建议先弄清情况，别直接拉。',
  gone: '上游分支已经被远程删掉了。',
  no_upstream: '当前分支没有配上游，没有可比的对象。',
}

/** 判决的短标签，给清单页那一列用（那里宽度有限）。 */
export const VERDICT_LABEL: Record<UpdateVerdict, string> = {
  safe: '可更新',
  diverged: '要你决定',
  rewritten: '别拉',
  unrelated: '别拉',
  gone: '上游没了',
  no_upstream: '没上游',
}

/** 从短码重建一条推荐（`reason` 用上面那份固定说法）。 */
export function recommendationFrom(verdict: UpdateVerdict, canPull = false): UpdateRecommendation {
  return { verdict, ahead: null, behind: null, canPull, reason: VERDICT_REASON[verdict] }
}

/** 列表页需要的最小检查摘要，M1 恒为 null（无 git 层）。 */
export interface UpdateCheckSummary {
  checkedAt: string
  status: UpdateStatus
  aheadCount: number | null
  behindCount: number | null
  /**
   * 上次检查时算出的「推不推荐更新」。
   *
   * **为什么它要落库而不是现算**：算它必须先 fetch（要问远程），
   * 而清单页读状态是纯本地的、不联网的。现算会得到「本地 refs 里的旧结论」，
   * 那正好是这个软件最不该做的事——拿没依据的数字冒充依据。
   * 所以结论只在真正检查过的那一刻产生，之后原样显示，并标出它是什么时候得出的。
   */
  recommendation: UpdateRecommendation | null
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
 * 绿色「已是最新」** —— 正是这个软件最要消灭的那种「没有依据的肯定」。
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

export const ATTENTION_VALUES = ['unchecked', 'blocked', 'decide', 'ready', 'synced'] as const

/**
 * 「这个仓库现在该不该动」——从**最近一次真正问到远程结论**的那次检查推出来的。
 *
 * **分类时间无关**（可筛选），而「上次看是最新」那类措辞降级是**时间相关**
 * 的（不可筛选）。两层分开，筛选才不会因为你看久了而漂。
 *
 * 判定在服务端算一次（`repos/projects.ts` 的 `ATTENTION_SQL`），随列表与详情
 * 返回。前端不再重算——显示、筛选、计数三处共用同一份，才不可能漂。
 */
export type Attention = (typeof ATTENTION_VALUES)[number]

/** 列表排序。默认 `name`。 */
export type ProjectSort = 'name' | 'checked' | 'behind'

/** 列表页的一行：项目 + tag + 最近一次检查摘要。 */
export interface ProjectListItem extends Project {
  tags: Tag[]
  latestCheck: UpdateCheckSummary | null
  /** 服务端算好的行动分类。前端只渲染，不重算。 */
  attention: Attention
}

/**
 * 详情页拿到的就是列表页那一份：记录在 `Project.record` 里，不再有「只有详情页
 * 才需要」的附加数据（原来这里挂着 `notes` 和 `notesCount`）。
 * 保留这个别名是因为调用方读起来仍然是在说详情页。
 */
export type ProjectDetail = ProjectListItem

/** 错误响应统一形状。 */
export interface ApiErrorBody {
  code: string
  message: string
  issues?: { path: string; message: string }[]
}
