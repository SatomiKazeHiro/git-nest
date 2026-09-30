import type { RepoStatus, UpdateStatus } from '@git-nest/core'

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

export function statusTitle(s: RepoStatus): string {
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
      return '本地与上次 fetch 到的远程一致'
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
export function StatusCell({ status }: { status: RepoStatus | undefined }) {
  if (!status) {
    return <span className="font-mono text-[12px] text-ink-3">读状态…</span>
  }
  if (!status.isRepo) {
    return (
      <span className="font-mono text-[12px] text-ink-3" title={statusTitle(status)}>
        {statusText(status.status)}
      </span>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={statusTitle(status)}>
      <span className="max-w-24 truncate font-mono text-[12px] text-ink">
        {status.branch ?? (status.detached ? 'detached' : '—')}
      </span>
      {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
      {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
      <span className={`truncate text-[12px] ${statusTone(status.status)}`}>
        {statusText(status.status)}
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