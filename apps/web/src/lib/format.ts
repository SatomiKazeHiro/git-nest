const DAY = 86_400_000

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return formatDate(iso)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 路径太长时中间省略，保留盘符/开头与末两级目录 */
export function shortenPath(p: string, keep = 3): string {
  const parts = p.split('/').filter(Boolean)
  if (parts.length <= keep + 1) return p
  return [parts[0], '…', ...parts.slice(-keep)].join('/')
}
