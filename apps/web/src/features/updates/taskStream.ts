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
 * 断流后的重连策略。
 *
 * 服务端只在收尾时发 `{"type":"closed"}`；服务端进程被杀、网络断掉时这个事件
 * 永远不会到，所以必须自己兜底，否则 `busy` 一直是 true，
 * 面板的按钮永久禁用、进度卡在「N/M · 连接中」，用户只能关掉面板重开。
 */
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 500
/** 服务端每 25s 一个心跳；超过这么久没有任何事件就认为流死了 */
const SILENCE_TIMEOUT_MS = 75_000

export interface UpdateTaskOptions {
  /** 断流后重开连接的等待（测试用；生产走默认值） */
  retryDelayMs?: number
  /** 多久没有任何事件就认为流死了（测试用；生产走默认值） */
  silenceTimeoutMs?: number
}

/**
 * 跑一个批量任务并订阅进度。
 *
 * EventSource 只能 GET，所以更新任务由 POST 启动、拿 id 去订阅；
 * 服务端把事件缓冲下来，重连时从头重放（幂等：item 按 projectId 覆盖），
 * 因此重连不会丢进度。
 */
export function useUpdateTask(onFinished?: () => void, options: UpdateTaskOptions = {}) {
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS
  const silenceTimeoutMs = options.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS
  const [task, setTask] = useState<TaskSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  /** 关掉**指定的**那条流；只有它还是当前流时才清 ref。 */
  const closeSource = useCallback((source: EventSource | null) => {
    source?.close()
    if (sourceRef.current === source) {
      sourceRef.current = null
      setConnected(false)
    }
  }, [])

  const close = useCallback(() => {
    closeSource(sourceRef.current)
  }, [closeSource])

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
    // openStream 在下面定义，但只在调用时用到，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [close],
  )

  const openStream = useCallback(
    (initial: TaskSnapshot) => {
      let current = initial
      let retries = 0
      let finished = false
      let silenceTimer: ReturnType<typeof setTimeout> | null = null
      let retryTimer: ReturnType<typeof setTimeout> | null = null

      const clearTimers = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        if (retryTimer) clearTimeout(retryTimer)
        silenceTimer = null
        retryTimer = null
      }

      /** 收尾：复位 busy、报错、并确保不再重连 */
      const giveUp = (message: string, stillOpen = false) => {
        clearTimers()
        setConnected(false)
        setError(message)
        setBusy(false)
        finished = true
        const source = sourceRef.current
        if (stillOpen && source) closeSource(source)
      }

      const armSilenceWatchdog = (source: EventSource) => {
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          // 这么久没有任何事件 = 流死了（服务端不会静默这么久）
          closeSource(source)
          giveUp('进度流断了，没能恢复。可以点「重新检查」再试一次。', true)
        }, silenceTimeoutMs)
      }

      const connect = () => {
        if (finished) return
        const source = new EventSource(`/api/updates/${initial.id}/events`)
        sourceRef.current = source
        armSilenceWatchdog(source)

        source.onopen = () => setConnected(true)

        source.onerror = () => {
          // 旧 source 的迟到回调不许影响新连接
          if (sourceRef.current !== source) return
          setConnected(false)
          if (finished) return

          closeSource(source)
          if (retries >= MAX_RETRIES) {
            giveUp('进度流断了，重连几次都没成功。可以点「重新检查」再试一次。')
            return
          }
          retries += 1
          retryTimer = setTimeout(connect, retryDelayMs)
        }

        source.onmessage = (raw) => {
          if (sourceRef.current !== source) return
          armSilenceWatchdog(source)

          let event: StreamEvent
          try {
            event = JSON.parse(raw.data) as StreamEvent
          } catch {
            return // 非 JSON 帧（代理注入等）不该炸掉整个流
          }

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
            clearTimers()
            finished = true
            setConnected(false)
            setBusy(false)
            closeSource(source)
            if (current.status !== 'running') finishedRef.current?.()
            return
          }
          setTask(current)
        }
      }

      connect()
    },
    [closeSource],
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
