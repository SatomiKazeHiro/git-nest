import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Eraser, RefreshCw, Terminal } from 'lucide-react'
import { Button, ErrorNote } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SettingRow } from './SettingRow'
import { ApiError, api } from '@/lib/api'

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
  const [banner, setBanner] = useState<string | null>(null)
  /** 清空日志也要问一句：它丢的是记录（不是用户的数据，所以不涂红，但会丢东西） */
  const [confirmingClear, setConfirmingClear] = useState(false)
  const { data, isPending, error } = useQuery({
    queryKey: commandKeys.all,
    queryFn: () => api.get<CommandsResponse>(`/commands?limit=${SHOW}`),
    /*
      **一定要在关闭状态下也发这一次请求。**

      原来这里是 `enabled: open`——「这是个排查视图，别在后台一直请求」。
      于是「上一轮跑了哪些仓库」那条摘要也一起被关在了外面：它在结构上
      永远显示「还没跑过」，除非用户先点开命令日志。摘要与日志列表是同一份
      响应里的两个字段，却因为共用一个开关而绑在了一起。

      现在：进页面取一次（50 条，本地服务，微不足道），**轮询**仍然只在展开时开
      ——真正该省的是每 5 秒一次的轮询，不是这一次。
    */
    refetchInterval: open ? 5_000 : false,
  })

  const runNow = useMutation({
    mutationFn: () => api.post<{ summary: unknown }>('/auto-fetch', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: commandKeys.all }),
    onError: (e) => setBanner(e instanceof ApiError ? e.message : '跑不起来'),
  })

  const clear = useMutation({
    mutationFn: () => api.del('/commands'),
    onSuccess: () => qc.invalidateQueries({ queryKey: commandKeys.all }),
    onError: (e) => setBanner(e instanceof ApiError ? e.message : '清不掉'),
  })

  const last = data?.lastAutoFetch
  // 读不到日志时**不能**显示成「还没有命令记录」——那是在说一件假事：
  // 空的日志和查不出来的日志，用户要做的事完全不一样（等一轮 vs 去看服务端）
  const readFailed = error instanceof ApiError ? error.message : error ? '服务端没应答' : null

  return (
    <section>
      {confirmingClear ? (
        <ConfirmDialog
          title="清空命令日志？"
          description="清掉的是这份记录本身（服务端内存里最近 1000 条，重启也会清）。它是排查工具，不是审计系统——清掉之后这段时间的痕迹就没了；正在跑的任务不受影响。"
          confirmText="清空"
          /* 丢的是记录，不是用户的数据：拦一下，但不涂红 */
          danger={false}
          loading={clear.isPending}
          onConfirm={() =>
            clear.mutate(undefined, { onSettled: () => setConfirmingClear(false) })
          }
          onClose={() => setConfirmingClear(false)}
        />
      ) : null}
      <SettingRow
        name="自动 fetch"
        desc="服务启动 30 秒后跑一轮，之后每 30 分钟一轮"
        note="让「落后多少 / 推不推荐更新」的数字保持新鲜"
      >
        <div className="flex flex-wrap items-center gap-2">
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
            <Button onClick={() => setConfirmingClear(true)} disabled={clear.isPending}>
              <Eraser size={14} aria-hidden />
              清空
            </Button>
          ) : null}
        </div>
      </SettingRow>

      {banner ? (
        <div className="py-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      {/*
        上一轮的结果是**三个计数**，不是一句话。
        原来写成 `上轮：2 个有结论 / 0 跳过 / 0 失败`——用斜杠串起来的一行字，
        眼睛要顺着读完才知道哪一个是几。这里拆成三格，标签在上、数字在下：
        哪个数字对应哪件事不用读，读到就看见了。
      */}
      <SettingRow
        name="上一轮"
        desc="这轮自动 fetch 跑了哪些仓库"
        note="只读，不改任何文件"
      >
        {readFailed ? (
          <p className="font-mono text-[12px] text-signal-bad">读不到状态</p>
        ) : last ? (
          <div className="flex gap-6">
            <Stat label="有结论" value={last.checked} />
            <Stat label="跳过" value={last.skipped} />
            <Stat label="失败" value={last.failed} bad={last.failed > 0} />
            <span className="self-end pb-0.5 text-[11.5px] text-ink-3">{agoOf(last.at)}</span>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-3">还没跑过。等下一轮，或者上面手动跑一次。</p>
        )}
      </SettingRow>

      {open ? (
        <div className="border border-line-soft bg-panel">
          {isPending ? (
            <p className="px-3 py-2 font-mono text-[12px] text-ink-3">读取中…</p>
          ) : readFailed ? (
            <div className="px-3 py-2">
              <ErrorNote message={`读不到命令日志：${readFailed}`} />
            </div>
          ) : !data || data.entries.length === 0 ? (
            <p className="px-3 py-2 text-[12.5px] text-ink-3">
              还没有命令记录。跑一轮检查或者等自动 fetch 之后就有了。
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

/** 一个计数：标签在上、数字在下。数字是等宽的，免得刷新时左右跳。 */
function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`font-mono text-[18px] leading-tight ${bad ? 'text-signal-bad' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  )
}

function agoOf(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
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
