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
 * 内置分类。**它是迁移的种子与前端兜底的同一来源。**
 *
 * 分类现在是**一份可配置的名单**（服务端的 `categories` 表），不再是编译期的枚举；
 * 这里只留「内置四个」。四条事实，缺一条这个设计就不成立：
 *
 * 1. **key 是稳定的，而且就是库里已经存着的那些值**——`projects.category` 里写的
 *    就是 `knowledge-base` / `backups` / `experiments` / `tools`。所以「分类变成
 *    可配置」这件事**不涉及任何数据迁移**：新表只是给这些值补上「显示名 + 图标 +
 *    是不是内置」。key 一旦写进项目就不改（用户改的是 `label`）。
 * 2. **`label` 只是显示名**：筛选、分组、排序全读 key，只有界面读 label。
 * 3. **内置项不可改名、不可删**（服务端拒绝）：它们不是用户的数据，是这个软件自带
 *    的四个桶——`projects.category` 里那一串值没有别的地方可以解释。
 * 4. 为什么不从接口读：迁移要用它写种子，而前端在列表还没回来（或接口失败）时要用
 *    它兜底，两处都不能等一次网络往返。
 *
 * ## 为什么这样仍然封着当初「自由文本会造出 backup/backups」那条顾虑
 *
 * 当初把分类从自由文本改成枚举，理由之一是自由文本会出现 `backup` / `backups`、
 * `试验` / `experiments` 这类近似重复，分组时看着像凭空多了一组。现在分类又能自己
 * 加了，但那个洞仍然封着：
 *
 * - 用户给的是**显示名**，`key` 由服务端从名称生成且保证唯一（`AI 项目` → `ai`，
 *   撞了就 `ai-2`，中文取不出 slug 就是 `cat-1`）——不会出现两个拼写相近的 key；
 * - 填分类是**从名单里挑**，不是打字——手误产生的近似重复没有了。
 *
 * 剩下的只有「故意起两个同名分类」，那是用户的决定，不是这个设计漏掉的。
 */
export const BUILTIN_CATEGORIES = [
  { key: 'knowledge-base', label: '知识库', icon: 'book-open', sortOrder: 0 },
  { key: 'backups', label: '备份', icon: 'archive', sortOrder: 1 },
  // 「试验」不是「实验」（用户确认过）
  { key: 'experiments', label: '试验', icon: 'flask-conical', sortOrder: 2 },
  { key: 'tools', label: '工具', icon: 'wrench', sortOrder: 3 },
] as const

/**
 * 一个分类（接口形状）。
 *
 * `builtin` 由**服务端**说了算：内置项不能改名、不能删。`projectCount` 只在列表
 * 接口里带上——设置页要显示「N 个项目」，删之前那句「会从 N 个项目上摘掉」就是它。
 */
export interface Category {
  key: string
  label: string
  icon: string | null
  builtin: boolean
  projectCount: number
}

/**
 * 内置分类的**接口形状**（`projectCount` 恒为 0）。
 *
 * 前端在列表还没回来、或者接口失败时用它兜底。三个地方都不能拿空数组顶：
 * 左栏那一段会整段消失、表单里一个选项都没有、详情页会把 `ai` 这种 key 原样显示
 * 出来——三个都像「坏了」。而内置四个任何时候都成立：它们是软件自带的。
 *
 * 引用数填 0 而不是留空：调用点要的是同一个形状，真假由调用点自己知道
 * （需要真实引用数的地方用原始查询，见 `features/categories/queries.ts`）。
 */
export function builtinCategoryList(): Category[] {
  return BUILTIN_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    icon: c.icon,
    builtin: true,
    projectCount: 0,
  }))
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

/**
 * 前端与后端的**默认端口**。
 *
 * ## 为什么它住在 core
 *
 * 这两个数字要在**两个进程、两套配置系统**里各用一次：server 的监听端口与 CORS
 * 白名单（`apps/server/src/config.ts`）、vite 的监听端口与代理目标
 * （`apps/web/vite.config.ts`）。各写一份的后果不是「报错」，而是**悄悄不一致**：
 * 漏改 CORS 那一处，界面每个写操作都会 403，而那条报错不会告诉你是端口没跟上
 * （跨站写入闸只会说「拒绝跨站写入」）。放在两端共用的包里，改一处就够。
 *
 * ## 只有默认值在这里
 *
 * `GIT_NEST_PORT` / `GIT_NEST_CORS` / `GIT_NEST_API` 三个环境变量照旧各自能盖回去，
 * 所以这层约束**随时可撤**：谁要临时换端口，不用改代码。
 *
 * ## 选号理由
 *
 * - 避开 1xxxx / 2xxxx：那是「默认端口 + 10000 / 20000」那套惯例的区段，
 *   同一台机器上跑别的项目时最容易撞；
 * - 不越过 **49151**：Windows 的动态端口范围从 49152 起，绑在那里面会偶发
 *   「地址已被占用」，而那个错误很难归因。
 */
export const DEFAULT_PORTS = { web: 36378, api: 36379 } as const

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

/**
 * 每个 attention 值**是什么意思**。判据本身在服务端那条 SQL 里（`ATTENTION_SQL`，
 * 由 `update_checks.detail` 的 `verdict` / `canPull` 算出来），但「它们分别代表什么」
 * 得写在**取值旁边**：读 core 的人只看到上面那串短码，猜不出 `blocked` 和 `decide`
 * 差在哪，于是必须跑去读一条 SQL 字符串才知道。
 *
 * - `ready`     确实有东西可拉（`canPull`）——唯一「现在就该动手」的一类
 * - `blocked`   作者改写过历史 / 换了仓库（`rewritten` / `unrelated`），要人看一眼才知道怎么办
 * - `decide`    分叉（`diverged`），得人决定
 * - `unchecked` 还没问过远程（没有合格检查，或旧记录缺字段——**不猜**）
 * - `synced`    问过了，没事（`safe` 且没有可拉的）
 *
 * **它同时是列表「按状态」排序的次序**：能动手的在前，没事的垫底（升序）。
 *
 * 这个次序原来只写在服务端那条 SQL 的 `CASE … THEN 0…4` 里——于是「加一个值」
 * 要改两处，漏一处不报错（SQL 里没有编译期检查）。现在次序住在这里、SQL 由它生成
 * （见 `repos/projects.ts`），`attention-rank.test.ts` 钉着「取值与次序一一对应」。
 */
export const ATTENTION_RANK: readonly Attention[] = [
  'ready',
  'blocked',
  'decide',
  'unchecked',
  'synced',
]

/** 列表排序。默认 `name`。顺序与设计文档 6.1 列的一致：名称 / 状态 / 上次检查 / 差异。 */
export type ProjectSort = 'name' | 'attention' | 'checked' | 'behind'

/** 排序方向。`dir` 不传时用下面那张默认表里的方向。 */
export type SortDir = 'asc' | 'desc'

/**
 * 每个排序键**第一次点**的方向：与历史上那个下拉选出来的顺序完全一致。
 *
 * 它是共用的而不是各端各写一份：服务端在 `dir` 缺省时要用它（老链接、老调用
 * 不能因为加了方向就换了顺序），前端点表头时也要用它（`按名称` 先升序、
 * `按上次检查` / `按落后数` 先降序——「最近查过的在前」「落后最多的在前」
 * 才是这两个键想问的问题）。
 *
 * `attention` 是升序：它的「值」是一个**行动优先的序号**（见服务端 `orderBy`），
 * 序号小的在前就是「该动手的排前面」。
 */
export const DEFAULT_SORT_DIR: Record<ProjectSort, SortDir> = {
  name: 'asc',
  attention: 'asc',
  checked: 'desc',
  behind: 'desc',
}

/** 列表页的一行：项目 + tag + 最近一次检查摘要。 */
export interface ProjectListItem extends Project {
  tags: Tag[]
  latestCheck: UpdateCheckSummary | null
  /** 服务端算好的行动分类。前端只渲染，不重算。 */
  attention: Attention
  /**
   * 从仓库里认出来的 logo 有没有。
   *
   * **只给一个布尔，不给路径**：那是一条仓库内的相对路径，它没有任何理由顺着
   * HTTP 出去（README 那一路也是「路径不出本机」）。要图的时候去打
   * `/api/projects/:id/logo`——它自己会去仓库里读。
   *
   * 这个布尔是必要的，不是图省事：没有它，列表里每一行都得发一个 `<img>` 去试，
   * 而**大多数项目没有 logo**，十几个 404 会在控制台里红成一片。
   */
  hasLogo: boolean
  /**
   * 认出来的项目类型（`'vue'`、`'nestjs'`、`'cpp'`…），认不出是 `null`。
   *
   * 它就是 `apps/web/src/assets/types/<type>.svg` 里的那个名字——前端拿它去查图标。
   * **`null` 是常见结果**（一半以上的仓库认不出来），界面上不显示角标。
   */
  projectType: string | null
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
