import { useCallback, useEffect, useRef, useState } from 'react'
import type { PullResult, UpdateReport } from '@git-nest/core'
import { ApiError, api } from '@/lib/api'

export interface TaskItem {
  projectId: number
  name: string
  state: 'pending' | 'running' | 'done' | 'failed'
  result?: UpdateReport | PullResult
  error?: string
}

export interface TaskSnapshot {
  id: string
  kind: 'check' | 'apply'
  status: 'running' | 'done' | 'failed'
  total: number
  done: number
  items: TaskItem[]
  summary?: Record<string, number>
  /** 因为 personal 默认不参与而没查的项目 */
  skipped?: string[]
  error?: string
}

type StreamEvent =
  | { type: 'started' }
  | { type: 'item'; item: TaskItem; done?: number }
  | { type: 'finished'; summary: Record<string, number> }
  | { type: 'error'; message: string }
  | { type: 'closed' }

export function isReport(r: TaskItem['result']): r is UpdateReport {
  return Boolean(r && 'incoming' in r)
}

export function isPull(r: TaskItem['result']): r is PullResult {
  return Boolean(r && 'outcome' in r)
}

export function startCheck(ids?: number[]) {
  return api.post<TaskSnapshot>('/updates/check', ids ? { ids } : {})
}

export function startApply(ids: number[]) {
  return api.post<TaskSnapshot>('/updates/apply', { ids })
}

/**
 * 跑一个批量任务并订阅进度。
 *
 * EventSource 只能 GET，所以更新任务由 POST 启动、拿 id 去订阅；
 * 服务端把事件缓冲下来并认 Last-Event-ID，断线重连不会丢进度。
 */
export function useUpdateTask(onFinished?: () => void) {
  const [task, setTask] = useState<TaskSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  const close = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setConnected(false)
  }, [])

  useEffect(() => close, [close])

  const run = useCallback(
    async (start: () => Promise<TaskSnapshot>) => {
      setBusy(true)
      setError(null)
      close()
      try {
        const initial = await start()
        setTask(initial)
        openStream(initial)
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '启动失败')
        setBusy(false)
      }
    },
    [close],
  )

  const openStream = useCallback(
    (initial: TaskSnapshot) => {
      let current = initial
      const source = new EventSource(`/api/updates/${initial.id}/events`)
      sourceRef.current = source

      source.onopen = () => setConnected(true)
      source.onerror = () => setConnected(false)

      source.onmessage = (raw) => {
        const event = JSON.parse(raw.data) as StreamEvent

        if (event.type === 'item') {
          const items = current.items.map((i) =>
            i.projectId === event.item.projectId ? event.item : i,
          )
          current = { ...current, items, done: event.done ?? current.done }
        } else if (event.type === 'finished') {
          current = { ...current, status: 'done', summary: event.summary, done: current.total }
        } else if (event.type === 'error') {
          current = { ...current, status: 'failed', error: event.message }
        } else if (event.type === 'closed') {
          setConnected(false)
          setBusy(false)
          close()
          if (current.status !== 'running') finishedRef.current?.()
          return
        }
        setTask(current)
      }
    },
    [close],
  )

  return {
    task,
    busy,
    error,
    connected,
    startCheck: (ids?: number[]) => run(() => startCheck(ids)),
    startApply: (ids: number[]) => run(() => startApply(ids)),
    reset: () => {
      close()
      setTask(null)
      setError(null)
      setBusy(false)
    },
  }
}
