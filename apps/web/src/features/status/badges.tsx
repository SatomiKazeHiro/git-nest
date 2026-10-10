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
 * 「跟远程差多少」。**全用中性灰**：它是上下文，不是行动项——
 * 该动不动看左边那列的彩色药丸。
 */
export function SyncBadge({
  ahead,
  behind,
  upstreamGone,
  hasCheck,
  hasStatus,
}: {
  ahead: number | null
  behind: number | null
  upstreamGone: boolean
  /** 有没有「合格检查」——没有的话所有数字都不可信，只能说「未知」 */
  hasCheck: boolean
  /**
   * 这一行的 git 状态**读回来了吗**。
   *
   * 不能省，也不能靠 `ahead === null` 推断：刷新页面时清单先到、逐仓库的状态
   * 1–2 秒后才到，而 `ahead/behind` 在**还没读到**和**读到了但不可比**（没有上游）
   * 两种情况下都是 null。把两者混成一个，没读到的时候就会显示「一致」——
   * 一个没有依据的肯定。（与 `DeriveInput.skipDirty` 同一条道理：把前提写明，
   * 而不是依赖某个值恰好是什么。）
   */
  hasStatus: boolean
}) {
  const a = ahead ?? 0
  const b = behind ?? 0
  const text = !hasStatus
    ? '—'
    : !hasCheck
      ? '未知'
      : upstreamGone
        ? '上游已关闭'
        : a > 0 && b > 0
          ? '已分叉'
          : b > 0
            ? '远程领先'
            : a > 0
              ? '本地领先'
              : '一致'
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-flat-bg px-2 py-[3px] text-[11.5px] text-flat">
      {text}
    </span>
  )
}

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
  hasCheck,
  hasStatus,
}: {
  ahead: number | null
  behind: number | null
  /** 没有合格检查时**不给数字**——`↓0 ↑0` 是编出来的，不是查到的 */
  hasCheck: boolean
  /** 状态还没读回来时同理：此刻谁也不知道那两个数是多少 */
  hasStatus: boolean
}) {
  // 没有依据就不给数字。两种「没有依据」：还没读到（刷新后要 1–2 秒），
  // 以及没有合格的远程检查。
  if (!hasStatus || !hasCheck) return <span className="text-[12px] text-ink-3">—</span>
  const a = ahead ?? 0
  const b = behind ?? 0
  return (
    <span className="whitespace-nowrap font-mono text-[12px]">
      <span className={b > 0 ? 'text-ok' : 'text-ink-3'}>↓{b}</span>{' '}
      <span className={a > 0 ? 'text-amber' : 'text-ink-3'}>↑{a}</span>
    </span>
  )
}
