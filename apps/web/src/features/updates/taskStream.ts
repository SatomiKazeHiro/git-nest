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
  /*
    重连/看门狗定时器的句柄放在 ref 里，**不在 `openStream` 的闭包里**。
    原来它们只活在闭包内，只有 `giveUp` / `closed` 事件会清：
    - 流断 → `onerror` 排了一个 500ms 后的重连 →
    - 用户点 × 或「重新检查」（`reset()` 只关 EventSource）→
    - 定时器到点，为**旧任务**新建一条 EventSource 并覆盖 `sourceRef.current`，
      把新任务的连接顶掉；面板已卸载的话就是一条泄漏的连接 + 对已卸载组件 setState。
  */
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current.clear()
  }, [])

  /** 关掉**指定的**那条流；只有它还是当前流时才清 ref。 */
  const closeSource = useCallback(
    (source: EventSource | null) => {
      source?.close()
      if (sourceRef.current === source) {
        sourceRef.current = null
        setConnected(false)
      }
    },
    [],
  )

  const close = useCallback(() => {
    // 关流的同时把定时器一起清掉：不然「关掉面板」之后它还会自己接回来
    clearTimers()
    closeSource(sourceRef.current)
  }, [clearTimers, closeSource])

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

      /*
        定时器**注册进 ref**（而不是只留在闭包里）：`close()` 要能一次清干净。
        另外每个定时器回调都会先确认「自己还属于当前这一轮」——`generation` 变了
        就什么都不做，免得旧任务的定时器把新任务连接顶掉。
      */
      const track = (t: ReturnType<typeof setTimeout>) => {
        timersRef.current.add(t)
        return t
      }
      const untrack = (t: ReturnType<typeof setTimeout> | null) => {
        if (t) timersRef.current.delete(t)
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
        const previous = silenceTimer
        untrack(previous)
        if (previous) clearTimeout(previous)
        silenceTimer = track(
          setTimeout(() => {
            untrack(silenceTimer)
            silenceTimer = null
            // 这么久没有任何事件 = 流死了（服务端不会静默这么久）
            closeSource(source)
            giveUp('进度流断了，没能恢复。可以点「重新检查」再试一次。', true)
          }, silenceTimeoutMs),
        )
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
          retryTimer = track(
            setTimeout(() => {
              untrack(retryTimer)
              retryTimer = null
              // 这一轮可能已经被 close()/reset() 结束了（定时器已被清，这是双保险）
              if (finished) return
              connect()
            }, retryDelayMs),
          )
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
    [clearTimers, closeSource],
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
