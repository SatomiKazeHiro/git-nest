import type { RepoStatus, UpdateStatus } from '@git-nest/core'

/**
 * 状态显示。
 *
 * 一个必须诚实的前提：**ahead / behind 只反映上次 fetch 之后的事实**。
 * 状态接口不联网，所以一个从没检查过、或者上次检查是很久以前的仓库，
 * 它的「已是最新」是**没有依据的**——远程可能早就更新了。
 *
 * 办法：把「本地知道什么」和「什么时候知道的」分开显示。
 * 陈旧的状态不给颜色（不给颜色就是在说「这句我不敢担保」）。
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
 * 其余状态（dirty / detached / 没有远程）是纯本地事实，任何时候都可信。
 */
const REMOTE_CLAIMS = new Set<UpdateStatus>(['up_to_date', 'behind', 'ahead', 'diverged'])

/** 远程相关的状态在陈旧时降级为灰色 */
export function toneFor(status: UpdateStatus, freshness: FreshnessState): string {
  if (freshness !== 'fresh' && REMOTE_CLAIMS.has(status)) return 'text-ink-3'
  return TONE[status]
}

/** 没查过远程时，措辞要退一步：只说本地看到的事实 */
export function textFor(status: UpdateStatus, freshness: FreshnessState): string {
  if (freshness === 'never' && REMOTE_CLAIMS.has(status)) {
    return status === 'up_to_date' ? '没查过远程' : '没查过远程'
  }
  if (freshness === 'stale' && status === 'up_to_date') {
    return '上次看是最新'
  }
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

export function statusTitle(s: RepoStatus, freshness?: Freshness): string {
  const state = freshness ? freshnessOf(freshness) : 'fresh'
  const base = describe(s)
  if (!REMOTE_CLAIMS.has(s.status)) return base
  if (state === 'never') {
    return `${base}。这个还没检查过更新——远程有没有新东西是未知的，点「检查更新」去问一次`
  }
  if (state === 'stale') {
    return `${base}。这个数字来自上次检查时的 fetch，之后没再查过`
  }
  return base
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

/** 列表页那一列：分支 + ahead/behind + 脏标记 + 一句话状态。 */
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

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={title}>
      <span className="max-w-24 truncate font-mono text-[12px] text-ink">
        {status.branch ?? (status.detached ? 'detached' : '—')}
      </span>
      {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
      {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
      <span className={`truncate text-[12px] ${toneFor(status.status, freshness)}`}>
        {textFor(status.status, freshness)}
      </span>
    </span>
  )
}

function Delta({ n, dir }: { n: number; dir: 'ahead' | 'behind' }) {
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
