import {
  VERDICT_REASON,
  isRemoteCheckStatus,
  type RepoStatus,
  type UpdateRecommendation,
  type UpdateStatus,
  type UpdateVerdict,
} from '@git-nest/core'

/**
 * 状态这台机器在界面上的**文字与色彩**：一堆纯函数，没有一行 JSX。
 *
 * 拆开的理由不是「文件多大」，而是**规则的形状**：什么时候必须加限定语、
 * 绿色只给谁、多久算旧——这些都是政策，政策该能被单独验（见 `text.test.ts`），
 * 而渲染那半（`badges.tsx`）必须过 jsdom 才能测。
 *
 * 三条政策，每条都在防同一件事——**界面说出一件不成立的事**：
 *
 * 1. **新鲜度**（`STALE_AFTER_MS` / `freshnessOf`）。12 小时那条线只有这一份：
 *    清单的「上次看是已同步」与详情栏的「上次看是最新」不能一个 12 小时一个别的数。
 * 2. **话术降级**（`textFor` / `statusTitle`）。远程结论在没联网确认时必须带限定语，
 *    而纯本地事实任何时候都直说。**限定语是加在真实状态上的，不是替换它**——
 *    `behind 3` 的方向和数字来自本地 refs，那是可靠的，不可靠的只是
 *    「它现在还是不是这样」。
 * 3. **色彩**（`TONE` / `toneFor` / `VERDICT_TONE`）。绿只给「可以安全快进」，
 *    陈旧的远程结论降级成灰，其余不着色——**不用颜色替用户下结论**。
 */

/** 超过这个时长就认为「远程情况可能已经变了」 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000

interface Freshness {
  /** 最近一次「检查更新」的时间；null = 从没查过 */
  checkedAt: string | null
  now?: number
}

type FreshnessState = 'fresh' | 'stale' | 'never'

export function freshnessOf({ checkedAt, now = Date.now() }: Freshness): FreshnessState {
  if (!checkedAt) return 'never'
  const t = new Date(checkedAt).getTime()
  if (Number.isNaN(t)) return 'never'
  return now - t > STALE_AFTER_MS ? 'stale' : 'fresh'
}

/*
  这些状态是在拿远程做比较，没问过远程就不该说得那么肯定。
  其余状态是纯本地事实，任何时候都可信。

  **判据不在这里**：它曾经是本地一份 `REMOTE_CLAIMS = new Set([...四个])`，与 core 的
  `REMOTE_CHECK_STATUSES`、server 的 `COUNTED` 是同一件事的三份拷贝——三份一样时看不出
  问题，改一处才会炸（而这四处决定的正是「哪次检查算合格」，也就是界面的新鲜度）。
  现在直接用 core 的谓词，`tone-vocabulary.test.ts` 钉着"谓词与集合等价"。
*/
const isRemoteClaim = isRemoteCheckStatus

/** 远程相关的状态在陈旧时降级为灰色 */
export function toneFor(status: UpdateStatus, freshness: FreshnessState): string {
  if (freshness !== 'fresh' && isRemoteClaim(status)) return 'text-ink-3'
  return TONE[status]
}

/**
 * 远程相关的结论按新鲜度降级措辞。
 *
 * **限定词是附加在真实状态上的，不是替换它。** behind / ahead / diverged 的
 * 方向和数字来自本地 refs（也就是上次 fetch 的结果），方向是可靠的，
 * 不可靠的只是「它现在还是不是这样」。所以数字照给，只标注来源。
 */
export function textFor(status: UpdateStatus, freshness: FreshnessState): string {
  if (!isRemoteClaim(status)) return TEXT[status]

  if (freshness === 'never') {
    if (status === 'up_to_date') return '没查过远程'
    return `${TEXT[status]}（本地看到的，没联网确认）`
  }
  if (freshness === 'stale' && status === 'up_to_date') return '上次看是最新'
  return TEXT[status]
}

/** 状态 → 一句话。顺序按「用户下一步要做什么」排。 */
const TEXT: Record<UpdateStatus, string> = {
  up_to_date: '已是最新',
  behind: '落后远程',
  ahead: '领先远程',
  diverged: '已分叉',
  dirty: '有未提交改动',
  no_upstream: '没有上游',
  gone: '上游已被删',
  detached: '游离 HEAD',
  no_remote: '没有远程',
  no_commits: '还没有提交',
  missing: '目录不在了',
  not_a_repo: '不是 git 仓库',
  error: '读不出状态',
}

/** 状态 → 颜色档位。signal-* 四个颜色只在这里用，保证全局一致。 */
const TONE: Record<UpdateStatus, string> = {
  up_to_date: 'text-signal-ok',
  behind: 'text-signal-behind',
  ahead: 'text-signal-ahead',
  diverged: 'text-signal-bad',
  dirty: 'text-signal-ahead',
  no_upstream: 'text-ink-3',
  gone: 'text-ink-3',
  detached: 'text-signal-ahead',
  no_remote: 'text-ink-3',
  no_commits: 'text-ink-3',
  missing: 'text-ink-3',
  not_a_repo: 'text-ink-3',
  error: 'text-signal-bad',
}

export function statusText(status: UpdateStatus): string {
  return TEXT[status]
}

export function statusTone(status: UpdateStatus): string {
  return TONE[status]
}

/**
 * 详情卡上那句**理由**——写哪一句，或者干脆不写。
 *
 * 只有一条规矩：**这一行只该说上面还没说过的事**。两条规则都是它的推论。
 *
 * 1. **「不用动」的那一档不写。** `safe` + 不能拉 + 两边都没多出提交 ⇒ core 给的理由
 *    是「已是最新，没有要拉的。」，而上面那个状态词已经写着「已是最新」——同一件事
 *    的第二遍，还是一遍在 12px 的标签里、一遍在 13px 的正文里，读起来像界面重复
 *    渲染了一次。
 * 2. **能快进的时候不重复那个数字。** core 的详细版是「可以直接快进到远程的 22 个
 *    提交。」，而卡片上面已经印着 `↓22`。这里换成 core 那份**不带数字**的说法
 *    （`VERDICT_REASON.safe`——从历史结论重建时用的也是它，清单的 tooltip 读到的
 *    就是这句）。这句话真正的新信息是「可以快进」（不产生 merge、不会冲突），
 *    数字上面有了。
 *
 * 两条判据都取自**数据**（判决 + 能不能拉 + 两个计数），不匹配文案：措辞是 core 的
 * 事，这里只决定**要不要说、说哪一份**——不改写它的句子。
 *
 * ⚠️ 「本地领先」那档（`safe` 但不能拉、`ahead > 0`）**不能**套用第 2 条：它的理由
 * 是「本地有 N 个提交还没推，远程没有新东西可拉。」，那个数字背后是「还没推」和
 * 「远程没新东西」，不是重复。所以第 2 条只看 `canPull`。
 */
export function reasonFor(r: UpdateRecommendation | null): string {
  if (!r) return ''
  const nothingToDo =
    r.verdict === 'safe' && !r.canPull && (r.behind ?? 0) === 0 && (r.ahead ?? 0) === 0
  if (nothingToDo) return ''
  if (r.canPull) return VERDICT_REASON.safe
  return r.reason
}

/**
 * 工作区里那些改动 → 一句话 + 悬停说明。**分开说两类**，因为这两类对「能不能拉」
 * 的含义完全不同：
 *
 * - **已跟踪文件被改**（`M ` / `A ` / `D ` / `R `…）：更新可能覆盖它们，快进时
 *   git 会拦下；
 * - **未跟踪的新文件**（`??`）：多半是构建产物、`.venv`、下载的数据，更新通常碰不到。
 *
 * 混成一句「有未提交的改动」，用户就会看到一堆跟他无关的构建产物被当成拦路的理由。
 * core 的 `describeWorktree()` 已经按这条分过（那边给更新报告的跳过原因用，句子更长）；
 * 这里是详情卡 11px 的条件行，只留能扫的部分，**判据与那边一致**。
 *
 * 数不出来时（lean 档不读工作区，`dirty*` 恒为 0）**退回笼统一句**：宁可说得含糊，
 * 也不编一个 0 出来。
 */
export function worktreeNote(
  s: Pick<RepoStatus, 'dirty' | 'dirtyTracked' | 'dirtyUntracked'>,
): { text: string; title: string } | null {
  if (!s.dirty) return null
  const tracked = s.dirtyTracked
  const untracked = s.dirtyUntracked

  if (tracked > 0 && untracked > 0) {
    return {
      text: `${tracked} 个文件改过，另有 ${untracked} 个未跟踪`,
      title: `${tracked} 个已跟踪文件被改过——拉到会碰到它们的提交时会被拦下；另有 ${untracked} 个未跟踪的新文件，多半是构建产物、依赖目录这类`,
    }
  }
  if (tracked > 0) {
    return {
      text: `${tracked} 个文件改过还没提交`,
      title: `${tracked} 个已跟踪文件被改过还没提交；拉到会碰到它们的提交时会被拦下`,
    }
  }
  if (untracked > 0) {
    return {
      text: `只有 ${untracked} 个未跟踪文件`,
      title: `${untracked} 个新建、还没纳入 git 的文件，多半是构建产物、依赖目录这类；更新通常碰不到它们，但为稳妥起见也不会自动更新`,
    }
  }
  return {
    text: '有未提交的改动',
    title: '工作区有未提交的改动；拉到会碰到它们的提交时会被拦下',
  }
}

/**
 * 悬停说明。
 *
 * `freshness` 缺省是 `'never'`（**不是** `'fresh'`）：省略参数时应当退到最保守的说法，
 * 而不是替调用方断言「刚查过」。原来缺省 `'fresh'`，一旦有人忘了传，就会给出
 * 一个没有任何依据的肯定语气——正是这个仓库最忌讳的那类假话。
 */
export function statusTitle(s: RepoStatus, freshness?: Freshness): string {
  const state = freshness ? freshnessOf(freshness) : 'never'
  const base = describe(s)
  if (!isRemoteClaim(s.status)) return base

  const hasCounts = s.upstream !== null && (s.ahead !== null || s.behind !== null)

  if (state === 'never') {
    return hasCounts
      ? `${base}。这个数字来自本地的远程跟踪分支，没联网确认——点「联网检查更新」去问一次`
      : `${base}。本地还没有远程跟踪分支可比，点「联网检查更新」去问一次`
  }
  if (state === 'stale') {
    return `${base}。这个数字来自上次检查时的 fetch，之后没再查过`
  }
  // 新鲜（刚查过）时不再重复上面的结论，改成说清**这两个数字的来源**——
  // 否则这一行就是上面那行结论的复制品，纯噪音。
  return `${base}。数字来自上次检查 fetch 到的远程跟踪分支；它不联网，所以只反映那一刻的远程。`
}

function describe(s: RepoStatus): string {
  switch (s.status) {
    case 'behind':
      return `落后远程 ${s.behind ?? 0} 个提交`
    case 'ahead':
      return `领先远程 ${s.ahead ?? 0} 个提交`
    case 'diverged':
      return `分叉：领先 ${s.ahead ?? 0}、落后 ${s.behind ?? 0}`
    case 'dirty':
      return `${s.dirtyCount} 处未提交改动`
    case 'up_to_date':
      return '与上次 fetch 到的远程一致'
    case 'no_upstream':
      return '当前分支没有上游分支'
    case 'gone':
      return '上游分支已经被远程删掉了，本地这个分支还在；要重新推就 push -u，不用了就删掉本地分支'
    case 'no_remote':
      return '这个仓库没有配置 origin'
    case 'detached':
      return 'HEAD 不在任何一个分支上'
    case 'no_commits':
      return '仓库里还没有提交'
    case 'missing':
      return s.error?.message ?? '目录不在了'
    case 'not_a_repo':
      return s.error?.message ?? '这个目录不是 git 仓库'
    default:
      return s.error?.message ?? '读不出状态'
  }
}

/**
 * 判决 → 颜色。**只有「可更新」给绿色，「别拉」给红色**——
 * 其余都是「你得自己看一眼」，那就别用颜色替用户下结论。
 *
 * 清单那一格与详情栏的判决卡共用这一份：两处各写一份映射的话，
 * 改了一处忘了另一处，同一个判决就会在屏幕上出现两种颜色。
 */
export const VERDICT_TONE: Record<UpdateVerdict, string> = {
  safe: 'text-signal-ok',
  diverged: 'text-signal-ahead',
  rewritten: 'text-signal-bad',
  unrelated: 'text-signal-bad',
  gone: 'text-ink-3',
  no_upstream: 'text-ink-3',
}
