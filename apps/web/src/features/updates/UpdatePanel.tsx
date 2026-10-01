import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { UpdateReport } from '@git-nest/core'
import { Button, ErrorNote } from '@/components/ui'
import { statusText, statusTone } from '@/features/status/StatusCell'
import { isPull, isReport, useUpdateTask, type TaskSnapshot } from './taskStream'
import { useSettings } from '@/features/settings/queries'

/** 能安全 ff-only 更新的状态：远程有、本地没有，且本地没有会挡路的提交 */
const UPDATABLE = new Set(['behind'])

/**
 * 更新面板：检查 → 看报告 → 勾选 → 更新 → 结果汇总。
 *
 * 原则照抄设计文档：**绝不自动更新**。检查完只是给建议，
 * 真正动工作区的只有用户点了「更新选中的」之后的那一次。
 */
export function UpdatePanel({
  ids,
  onClose,
}: {
  /** 要检查的项目 id；为空表示当前筛选出的全部 */
  ids: number[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { task, busy, error, connected, startCheck, startApply, reset } = useUpdateTask(() => {
    void qc.invalidateQueries({ queryKey: ['projects'] })
    void qc.invalidateQueries({ queryKey: ['status'] })
    void qc.invalidateQueries({ queryKey: ['project'] })
  })
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const { data: settings } = useSettings()

  const reports = useMemo(
    () => (task?.items ?? []).filter((i) => isReport(i.result)),
    [task],
  )
  const updatable = reports.filter(
    (i) => isReport(i.result) && UPDATABLE.has(i.result.status),
  )

  // 数量多时先确认范围：检查会联网 fetch 十几个仓库，不能一点就开跑
  const threshold = settings?.confirmThreshold ?? 20
  const overThreshold = ids.length > threshold

  const toggle = (projectId: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })

  const startCheckNow = () => {
    if (overThreshold && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    reset()
    setPicked(new Set())
    void startCheck(ids.length > 0 ? ids : undefined)
  }

  return (
    <section className="mb-5 border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
        <h2 className="text-[14px] font-semibold text-ink">更新</h2>
        <p className="text-[12px] text-ink-3">
          检查会联网 fetch 远程；更新只在你勾选之后执行，且只做 fast-forward
        </p>
        <div className="ml-auto flex items-center gap-2">
          {busy ? (
            <span className="font-mono text-[12px] text-ink-3">
              {task ? `${task.done}/${task.total}` : '启动中'}
              {connected ? '' : ' · 连接中'}
            </span>
          ) : null}
          <Button onClick={startCheckNow} disabled={busy}>
            {busy ? '检查中…' : task ? '重新检查' : '检查更新'}
          </Button>          <button
            onClick={() => {
              reset()
              onClose()
            }}
            aria-label="关闭更新面板"
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[15px] leading-6 text-ink-3 hover:bg-paper hover:text-ink"
          >
            ×
          </button>
        </div>
      </header>

      {confirming && overThreshold ? (
        <p className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2.5">
          <span className="text-[13px] text-signal-ahead">
            要对 {ids.length} 个项目联网 fetch（超过确认阈值 {threshold}），确认吗？
          </span>
          <Button variant="primary" onClick={startCheckNow} disabled={busy}>
            确认，检查这 {ids.length} 个
          </Button>
          <Button onClick={() => setConfirming(false)}>再想想</Button>
        </p>
      ) : null}

      {error ? (
        <div className="px-4 pt-3">
          <ErrorNote message={error} />
        </div>
      ) : null}

      {!task ? (
        <p className="px-4 py-4 text-[13px] text-ink-2">
          {ids.length > 0
            ? `将检查当前筛选出的 ${ids.length} 个项目（personal 分类默认跳过，可在设置里打开）。`
            : '先在上方勾选项目，就只检查勾选的那几个。'}
        </p>
      ) : task.status === 'failed' ? (
        <div className="px-4 py-3">
          <ErrorNote message={task.error ?? '任务失败'} />
        </div>
      ) : (
        <>
          {task.skipped && task.skipped.length > 0 ? (
            <p className="border-b border-line-soft px-4 py-2 text-[12.5px] text-ink-3">
              跳过了 {task.skipped.join('、')}：personal 分类默认不参与检查
            </p>
          ) : null}

          <ul>
            {task.items.map((item) => (
              <TaskRow
                key={item.projectId}
                item={item}
                checked={picked.has(item.projectId)}
                onToggle={() => toggle(item.projectId)}
              />
            ))}
          </ul>

          {task.status === 'done' ? (
            <footer className="flex flex-wrap items-center gap-3 border-t border-line-soft px-4 py-2.5">
              {task.kind === 'check' ? (
                <>
                  <span className="text-[13px] text-ink-2">{checkSummary(task)}</span>
                  <Button
                    variant="primary"
                    disabled={picked.size === 0 || busy}
                    onClick={() => void startApply([...picked])}
                  >
                    更新选中的 {picked.size} 个
                  </Button>
                  {updatable.length > 0 && picked.size < updatable.length ? (
                    <button
                      onClick={() => setPicked(new Set(updatable.map((i) => i.projectId)))}
                      className="text-[12.5px] text-accent hover:underline"
                    >
                      全选可更新的 {updatable.length} 个
                    </button>
                  ) : null}
                  {picked.size > 0 ? (
                    <button
                      onClick={() => setPicked(new Set())}
                      className="text-[12.5px] text-ink-3 hover:text-ink"
                    >
                      清空勾选
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="text-[13px] text-ink-2">{applySummary(task)}</span>
              )}
            </footer>
          ) : null}
        </>
      )}
    </section>
  )
}

function TaskRow({
  item,
  checked,
  onToggle,
}: {
  item: TaskSnapshot['items'][number]
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li className="border-b border-line-soft px-4 py-2 last:border-b-0">
      <div className="flex items-center gap-2.5">
        {isReport(item.result) ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={!UPDATABLE.has(item.result.status)}
            title={
              UPDATABLE.has(item.result.status)
                ? '勾上就会 ff-only 更新到远程'
                : '这个状态不能安全快进，勾了也没用'
            }
            aria-label={`选择 ${item.name}`}
            className={`size-3.5 shrink-0 accent-[#14506e] ${
              UPDATABLE.has(item.result.status) ? '' : 'cursor-not-allowed opacity-40'
            }`}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        <Link
          to={`/projects/${item.projectId}`}
          className="w-40 min-w-0 shrink-0 truncate text-[13px] font-medium text-ink hover:text-accent"
        >
          {item.name}
        </Link>

        {item.state === 'running' ? (
          <span className="font-mono text-[12px] text-ink-3">检查中…</span>
        ) : item.state === 'failed' ? (
          <span className="text-[12.5px] text-signal-bad">{item.error ?? '失败'}</span>
        ) : isReport(item.result) ? (
          <ReportCell report={item.result} />
        ) : isPull(item.result) ? (
          <span
            className={`text-[12.5px] ${
              item.result.outcome === 'failed' ? 'text-signal-bad' : 'text-ink-2'
            }`}
          >
            {item.result.summary}
          </span>
        ) : null}
      </div>

      {isReport(item.result) && item.result.incoming.length > 0 ? (
        <ul className="mt-1.5 ml-12 flex flex-col gap-0.5">
          {item.result.incoming.slice(0, 4).map((c) => (
            <li key={c.shortHash} className="flex gap-2 text-[12.5px]">
              <span className="w-20 shrink-0 truncate font-mono text-[11.5px] text-ink-3">
                {c.shortHash}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{c.subject}</span>
            </li>
          ))}
          {item.result.incoming.length > 4 ? (
            <li className="text-[12px] text-ink-3">
              还有 {item.result.incoming.length - 4} 个提交
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

function ReportCell({ report }: { report: UpdateReport }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className={`text-[12.5px] ${statusTone(report.status)}`}>
        {statusText(report.status)}
      </span>
      {report.behind ? (
        <span className="font-mono text-[12px] text-signal-behind">↓{report.behind}</span>
      ) : null}
      {report.ahead ? (
        <span className="font-mono text-[12px] text-signal-ahead">↑{report.ahead}</span>
      ) : null}
      {report.tags.map((t) => (
        <span
          key={t}
          className="rounded-[2px] border border-line px-1 font-mono text-[11px] text-ink-2"
        >
          {t}
        </span>
      ))}
      {report.error ? (
        <span className="text-[12px] text-signal-bad">{report.error.message}</span>
      ) : null}
    </span>
  )
}

function checkSummary(task: TaskSnapshot): string {
  const s = task.summary ?? {}
  const parts: string[] = []
  if (s.behind) parts.push(`${s.behind} 个可更新`)
  if (s.upToDate) parts.push(`${s.upToDate} 个已是最新`)
  if (s.diverged) parts.push(`${s.diverged} 个已分叉`)
  if (s.ahead) parts.push(`${s.ahead} 个领先远程`)
  if (s.skipped) parts.push(`${s.skipped} 个没法检查`)
  if (s.failed) parts.push(`${s.failed} 个失败`)
  return parts.length > 0 ? `检查完：${parts.join('、')}` : '检查完了'
}

function applySummary(task: TaskSnapshot): string {
  const s = task.summary ?? {}
  const parts: string[] = []
  if (s.updated) parts.push(`已更新 ${s.updated} 个仓库，共 ${s.commits ?? 0} 个提交`)
  if (s.upToDate) parts.push(`${s.upToDate} 个已是最新`)
  if (s.skipped) parts.push(`${s.skipped} 个跳过`)
  if (s.failed) parts.push(`${s.failed} 个失败`)
  return parts.length > 0 ? parts.join(' · ') : '没有改动'
}
