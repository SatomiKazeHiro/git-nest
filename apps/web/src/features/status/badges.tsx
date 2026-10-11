import { VERDICT_LABEL, type Attention, type UpdateRecommendation } from '@git-nest/core'
import { STALE_AFTER_MS, VERDICT_TONE } from './text'

/**
 * 状态这台机器在界面上的**形状**：五个徽章 / 格子。
 * 文字与色彩的政策在 `./text`（纯函数，有测试），这里只把它们摆成 DOM。
 *
 * 三列的颜色分工是刻意的：
 * - **状态列**是唯一「该不该动」的那列，也只有它是彩色的（药丸）；
 * - **同步状态列**回答「跟远程差多少」，**全中性灰**——它是上下文，不是行动项；
 * - **差异列**是两个方向的数字。
 *
 * **蓝色不出现在这三列里**：蓝在这个应用里表示「你能点的 / 当前选中的」，
 * 四色只表示 git 事实。混进来，颜色就不再是一个能读的信号了。
 */

/**
 * `↑N` / `↓N`（领先/落后几个提交）。
 *
 * 清单页与更新面板的结果行都要这个，文案、箭头、颜色必须一致，
 * 所以只有这一份实现。原来 UpdatePanel 里另写了一份——两个地方各改一次很容易
 * 只改一处（比如只给一边加了 title）。
 */
export function Delta({ n, dir }: { n: number; dir: 'ahead' | 'behind' }) {
  return (
    <span
      className={`font-mono text-[12px] ${dir === 'ahead' ? 'text-signal-ahead' : 'text-signal-behind'}`}
      title={dir === 'ahead' ? `领先 ${n} 个提交` : `落后 ${n} 个提交`}
    >
      {dir === 'ahead' ? '↑' : '↓'}
      {n}
    </span>
  )
}

/**
 * 「推荐」那一格——**这是这个软件一阶段最要紧的一格**。
 *
 * 它回答的是「拉了会不会出事」，而不是「落后几个」。两种「别拉」要区分开：
 * - `rewritten`：作者 force push 了，直接拉会分叉/失败
 * - `unrelated`：作者把仓库整个换掉了（删库重建），拉等于换一个仓库
 *
 * ⚠️ 它显示的是**上次检查时**的结论（`reason` 在 title 里，鼠标停一下能看全）。
 * 没查过就是没有结论——那种情况给「没查过」，绝不给一个绿色的「可更新」。
 */
export function RecommendationCell({
  recommendation,
}: {
  recommendation: UpdateRecommendation | null
}) {
  if (!recommendation) {
    return (
      <span
        className="font-mono text-[12px] text-ink-3"
        title="还没点过「联网检查更新」。推不推荐更新必须先问过远程才算得出来——本地看不出作者有没有改写历史。"
      >
        没查过
      </span>
    )
  }
  return (
    <span className={`truncate text-[12px] ${VERDICT_TONE[recommendation.verdict]}`} title={recommendation.reason}>
      {VERDICT_LABEL[recommendation.verdict]}
    </span>
  )
}

const ATTENTION_TEXT: Record<Attention, string> = {
  ready: '可更新',
  synced: '已同步',
  blocked: '不推荐',
  decide: '需要确认',
  unchecked: '待检查',
}

const ATTENTION_CLASS: Record<Attention, string> = {
  ready: 'bg-ok-bg text-ok',
  synced: 'bg-flat-bg text-flat',
  blocked: 'bg-bad-bg text-bad',
  decide: 'bg-amber-bg text-amber',
  unchecked: 'bg-amber-bg text-amber',
}

/* 措辞降级的时长用 `./text` 的 STALE_AFTER_MS——「多久算旧」是同一件事，
   清单的「已同步」和详情栏的「已是最新」不该一个 12 小时一个别的数。 */

/**
 * 「该动吗」。读服务端给的 `attention`，**前端不重算**。
 *
 * `checkedAt` 只影响**措辞**不影响**颜色分档**：分类是时间无关的（可筛选），
 * 措辞是时间相关的（不可筛选）。这两层分开，筛选才不会因为你看久了而漂。
 */
export function AttentionBadge({
  attention,
  checkedAt,
}: {
  attention: Attention
  checkedAt: string | null
}) {
  const stale =
    checkedAt !== null && Date.now() - new Date(checkedAt).getTime() > STALE_AFTER_MS
  const base = ATTENTION_TEXT[attention]
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[11.5px] font-medium ${ATTENTION_CLASS[attention]}`}
    >
      {stale ? `上次看是${base}` : base}
    </span>
  )
}

/**
 * 那两个数字能不能拿来下结论。**四种情况必须分开**——它们都回答「有没有依据」，
 * 但依据缺在哪一步完全不同：
 * - `reading`：这一行的 git 状态还没读回来（刷新后清单先到、状态 1–2 秒后才到）
 * - `unreadable`：读到了，但这个目录不是可读的 git 仓库（不在了 / 不是仓库 / 出错）
 * - `no-upstream`：是仓库，但当前分支没有可比的上下游（比如上游被取消配置了）
 * - `ready`：有上游，`ahead/behind` 是刚读到的数字
 *
 * 前两种都给 `—`，第三种说「没有上游」——**都不是 0**。把 `null` 当 0 就是
 * 「刷新时先显示『一致』」那个 bug 的来源；少分一种，它就会从另一个门回来。
 */
export type Comparability = 'reading' | 'unreadable' | 'no-upstream' | 'ready'

/**
 * 「差异」列：↓ 远程领先 / ↑ 本地领先，两个方向都给。
 *
 * 叫 `Diff` 而不是复用上面那个 `Delta({n, dir})`——那个是「只显示一个方向、
 * 带 title 的一格」，更新面板的结果行还在用它；这里是两个方向并排的另一个形状。
 * 绿与琥珀对应上面两个药丸。
 */
export function Diff({
  ahead,
  behind,
  upstreamGone = false,
  hasCheck,
  comparable,
}: {
  ahead: number | null
  behind: number | null
  /** 上游被远程删掉了。它和「没配上游」是两件事，说法不同 */
  upstreamGone?: boolean
  /** 没有合格检查时**不给数字**——`↓0 ↑0` 是编出来的，不是查到的 */
  hasCheck: boolean
  /** 同上：只有 `ready` 才拿得到可信的数字 */
  comparable: Comparability
}) {
  /*
    没有依据时**说清是哪一种没有依据**，不是一律一个「—」。

    这三种的下一步动作完全不同：正在读 → 等；读不出来 → 去看目录；上游被删了 →
    去远端重建或换上游；没配上游 → 去配一个。所以说法要分开。

    这段说法原来住在 `SyncBadge`（「同步状态」那一列）。那一列按设计文档
    （5 列：仓库 / 分支 / 状态 / 差异 / 上次检查）收掉之后，**这些状态一条没丢**，
    只是并到了差异这一格——少一列不等于少一句话。
  */
  if (comparable !== 'ready' || !hasCheck) {
    const reason =
      comparable === 'reading' || comparable === 'unreadable'
        ? '—'
        : !hasCheck
          ? '未知'
          : upstreamGone
            ? '上游已关闭'
            : '没有上游'
    return <span className="text-[12px] text-ink-3">{reason}</span>
  }
  const a = ahead ?? 0
  const b = behind ?? 0
  return (
    <span className="whitespace-nowrap font-mono text-[12px]">
      <span className={b > 0 ? 'text-ok' : 'text-ink-3'}>↓{b}</span>{' '}
      <span className={a > 0 ? 'text-amber' : 'text-ink-3'}>↑{a}</span>
    </span>
  )
}
