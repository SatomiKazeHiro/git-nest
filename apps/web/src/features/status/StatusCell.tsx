import { VERDICT_LABEL, type RepoStatus, type UpdateRecommendation, type UpdateStatus, type UpdateVerdict } from '@git-nest/core'

/**
 * 清单页那一格：**只回答「跟远程差多少」**。
 *
 * 这里刻意不显示分支名，也不显示「有未提交改动」：
 * - 分支名是 git 客户端的事。设计文档第 1 节写明「不做 git 客户端」，
 *   而用户从没问过「它在哪个分支」——他自己很清楚。
 * - 脏不脏是仓库**内部**状态，这个软件管的是仓库**跟上游的关系**。
 *   它只在「要动工作区」的那一刻才有用（更新前的校验），不该长期挂在清单上。
 *   清单上挂它的后果是：跑过构建的目录几乎永远报脏，报到没人再看它。
 *
 * 剩下的三件事就是用户要的三件：落后了没、落后多少、能不能拉。
 */
/** 超过这个时长就认为「远程情况可能已经变了」 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000

export interface Freshness {
  /** 最近一次「检查更新」的时间；null = 从没查过 */
  checkedAt: string | null
  now?: number
}

export type FreshnessState = 'fresh' | 'stale' | 'never'

export function freshnessOf({ checkedAt, now = Date.now() }: Freshness): FreshnessState {
  if (!checkedAt) return 'never'
  const t = new Date(checkedAt).getTime()
  if (Number.isNaN(t)) return 'never'
  return now - t > STALE_AFTER_MS ? 'stale' : 'fresh'
}

/**
 * 这些状态是在拿远程做比较，没问过远程就不该说得那么肯定。
 * 其余状态是纯本地事实，任何时候都可信。
 */
const REMOTE_CLAIMS = new Set<UpdateStatus>(['up_to_date', 'behind', 'ahead', 'diverged'])

/** 远程相关的状态在陈旧时降级为灰色 */
export function toneFor(status: UpdateStatus, freshness: FreshnessState): string {
  if (freshness !== 'fresh' && REMOTE_CLAIMS.has(status)) return 'text-ink-3'
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
  if (!REMOTE_CLAIMS.has(status)) return TEXT[status]

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
 * 悬停说明。
 *
 * `freshness` 缺省是 `'never'`（**不是** `'fresh'`）：省略参数时应当退到最保守的说法，
 * 而不是替调用方断言「刚查过」。原来缺省 `'fresh'`，一旦有人忘了传，就会给出
 * 一个没有任何依据的肯定语气——正是这个仓库最忌讳的那类假话。
 */
export function statusTitle(s: RepoStatus, freshness?: Freshness): string {
  const state = freshness ? freshnessOf(freshness) : 'never'
  const base = describe(s)
  if (!REMOTE_CLAIMS.has(s.status)) return base

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
 * 清单页那一格。
 *
 * 有落后就只显示「↓N」+ 落后的颜色——这是清单上唯一需要突出的信息；
 * 其余情况给一句状态词。**不再显示分支名与脏标记**（理由见文件头）。
 */
export function StatusCell({
  status,
  checkedAt,
}: {
  status: RepoStatus | undefined
  checkedAt: string | null
}) {
  if (!status) {
    return <span className="font-mono text-[12px] text-ink-3">读状态…</span>
  }

  const freshness = freshnessOf({ checkedAt })
  const title = statusTitle(status, { checkedAt })

  if (!status.isRepo) {
    return (
      <span className="font-mono text-[12px] text-ink-3" title={title}>
        {statusText(status.status)}
      </span>
    )
  }

  // 落后多少是这个清单存在的理由，单独突出；顺带标一下这个数字有多旧
  if (status.behind) {
    return (
      <span className="flex min-w-0 items-center gap-1.5" title={title}>
        <Delta n={status.behind} dir="behind" />
        {freshness !== 'fresh' ? (
          <span className="font-mono text-[11px] text-ink-3" title="这个数字来自上次检查，之后没再问过远程">
            未确认
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <span
      className={`truncate text-[12px] ${toneFor(status.status, freshness)}`}
      title={title}
    >
      {textFor(status.status, freshness)}
    </span>
  )
}

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
 * 判决 → 颜色。**只有「可更新」给绿色，「别拉」给红色**——
 * 其余都是「你得自己看一眼」，那就别用颜色替用户下结论。
 *
 * 导出给详情栏的判决卡用：那里是同一个判决的放大版，**必须与清单里那一格
 * 同一个颜色**，两处各写一份映射的话，改了一处忘了另一处就会让同一个判决
 * 在屏幕上出现两种颜色。
 */
export const VERDICT_TONE: Record<UpdateVerdict, string> = {
  safe: 'text-signal-ok',
  diverged: 'text-signal-ahead',
  rewritten: 'text-signal-bad',
  unrelated: 'text-signal-bad',
  gone: 'text-ink-3',
  no_upstream: 'text-ink-3',
}

/**
 * 清单页的「推荐」列——**这是这个软件一阶段最要紧的一格**。
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
