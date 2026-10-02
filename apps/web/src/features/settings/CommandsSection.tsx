import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Eraser, RefreshCw, Terminal } from 'lucide-react'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'

/**
 * 命令日志：**这个软件自己跑了哪些 git 命令**。
 *
 * 用户的原话：「你可以自动 fetch，但你要记录所有执行过的命令下来，方便查看」。
 * 这是自动联网的配套——它自己动过什么，必须查得到。
 *
 * 日志在服务端内存里（最近 1000 条，重启清空）。它是排查工具，不是审计系统。
 */

interface CommandLogEntry {
  at: string
  /** 发起者：auto-fetch / check / pull / status */
  label: string
  args: string[]
  cwd: string
  code: number
  ms: number
  timedOut: boolean
}

interface CommandsResponse {
  entries: CommandLogEntry[]
  total: number
  lastAutoFetch: {
    at: string
    projects: number
    checked: number
    skipped: number
    failed: number
  } | null
}

const commandKeys = {
  all: ['commands'] as const,
}

/** 界面只需要看最近这些；几百个仓库跑过一轮之后全量会很吵。 */
const SHOW = 50

export function CommandsSection() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data, isPending } = useQuery({
    queryKey: commandKeys.all,
    queryFn: () => api.get<CommandsResponse>(`/commands?limit=${SHOW}`),
    // 只在展开时轮询：这是个排查视图，不该在后台一直请求
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  })

  const runNow = useMutation({
    mutationFn: () => api.post<{ summary: unknown }>('/auto-fetch', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: commandKeys.all }),
  })

  const clear = useMutation({
    mutationFn: () => api.del('/commands'),
    onSuccess: () => qc.invalidateQueries({ queryKey: commandKeys.all }),
  })

  const last = data?.lastAutoFetch

  return (
    <section>
      <h2 className="text-[15px] font-semibold text-ink">自动 fetch 与命令日志</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">
        服务启动 30 秒后自动跑一轮 fetch，之后每 30 分钟一轮——让「落后多少 / 推不推荐更新」
        的数字保持新鲜。<strong>它只更新远程跟踪引用，绝不碰你的工作区</strong>
        （不 pull、不快进、不改文件）。personal 分类默认跳过，跟着上面那个开关走。
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => runNow.mutate()} disabled={runNow.isPending}>
          <RefreshCw size={14} aria-hidden className={runNow.isPending ? 'animate-spin' : ''} />
          {runNow.isPending ? '正在跑…' : '现在跑一轮'}
        </Button>
        <Button onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <Terminal size={14} aria-hidden />
          {open ? '收起命令日志' : '看命令日志'}
        </Button>
        {open ? (
          <Button onClick={() => clear.mutate()} disabled={clear.isPending}>
            <Eraser size={14} aria-hidden />
            清空
          </Button>
        ) : null}
        {last ? (
          <span className="font-mono text-[12px] text-ink-3">
            上轮：{last.checked} 个有结论 / {last.skipped} 跳过 / {last.failed} 失败
          </span>
        ) : (
          <span className="font-mono text-[12px] text-ink-3">还没跑过</span>
        )}
      </div>

      {open ? (
        <div className="mt-3 border border-line-soft bg-panel">
          {isPending ? (
            <p className="px-3 py-2 font-mono text-[12px] text-ink-3">读取中…</p>
          ) : !data || data.entries.length === 0 ? (
            <p className="px-3 py-2 text-[12.5px] text-ink-3">
              还没有记录。跑一轮检查或者等自动 fetch 之后就有了。
            </p>
          ) : (
            <>
              <p className="border-b border-line-soft px-3 py-1.5 font-mono text-[11px] text-ink-3">
                最近 {data.entries.length} 条（共 {data.total} 条，新的在前）
              </p>
              <ul className="max-h-80 divide-y divide-line-soft overflow-y-auto">
                {data.entries.map((e, i) => (
                  <CommandRow key={`${e.at}-${i}`} entry={e} />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

function CommandRow({ entry }: { entry: CommandLogEntry }) {
  // 非零退出不一定是错误（「没有上游」就是预期内的非零），所以只标出来、不报警
  const bad = entry.timedOut || entry.code !== 0
  return (
    <li className="px-3 py-1.5" title={`${entry.cwd}\n退出码 ${entry.code}，用了 ${entry.ms}ms`}>
      <div className="flex items-baseline gap-2">
        <span className="w-16 shrink-0 font-mono text-[11px] text-ink-3">
          {timeOf(entry.at)}
        </span>
        <span className="w-20 shrink-0 truncate font-mono text-[11px] text-ink-3">
          {entry.label || '—'}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
          git {entry.args.join(' ')}
        </span>
        <span className={`shrink-0 font-mono text-[11px] ${bad ? 'text-signal-ahead' : 'text-ink-3'}`}>
          {entry.timedOut ? '超时' : entry.code === 0 ? `${entry.ms}ms` : `退出 ${entry.code}`}
        </span>
      </div>
      <div className="truncate pl-[9.5rem] font-mono text-[11px] text-ink-3">{entry.cwd}</div>
    </li>
  )
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}
