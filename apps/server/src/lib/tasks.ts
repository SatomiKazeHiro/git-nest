import { randomUUID } from 'node:crypto'

/**
 * 批量任务 + 进度推送。
 *
 * 批量检查更新可能要联网 fetch 十几个仓库，不能让 HTTP 请求一直挂着，
 * 所以：POST 启动任务拿 id，SSE 端点订阅进度。
 *
 * 事件用「缓冲数组 + 游标」而不是发布订阅：SSE 订阅端点比任务启动晚到是很常见的
 * （前端拿到 id 再开连接），缓冲能保证不丢事件，实现也简单得多。
 */

export type TaskKind = 'check' | 'apply'

export interface TaskItem {
  projectId: number
  name: string
  /** 排队中 / 进行中 / 已有结果 */
  state: 'pending' | 'running' | 'done' | 'failed'
  result?: unknown
  error?: string
}

export interface Task {
  id: string
  kind: TaskKind
  status: 'running' | 'done' | 'failed'
  createdAt: number
  total: number
  done: number
  items: TaskItem[]
  events: string[]
  finishedAt?: number
  summary?: Record<string, number>
  error?: string
}

const TTL_MS = 30 * 60_000
const tasks = new Map<string, Task>()

export function createTask(kind: TaskKind, projects: { id: number; name: string }[]): Task {
  sweep()
  const task: Task = {
    id: randomUUID(),
    kind,
    status: 'running',
    createdAt: Date.now(),
    total: projects.length,
    done: 0,
    items: projects.map((p) => ({ projectId: p.id, name: p.name, state: 'pending' })),
    events: [],
  }
  tasks.set(task.id, task)
  emit(task, { type: 'started', total: task.total, kind })
  return task
}

/** 快照与 SSE 都从这里拿任务：顺手清扫，别只依赖 createTask 那一次。 */
export function getTask(id: string): Task | null {
  sweep()
  return tasks.get(id) ?? null
}

/** 拿一份可序列化的快照（去掉事件缓冲，前端用不上）。 */
export function taskSnapshot(task: Task) {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    total: task.total,
    done: task.done,
    items: task.items,
    summary: task.summary,
    error: task.error,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
  }
}

/** 从游标开始的事件；SSE 断线重连时带上 Last-Event-ID 就能续上。 */
export function eventsSince(task: Task, cursor: number): { events: string[]; cursor: number } {
  return { events: task.events.slice(cursor), cursor: task.events.length }
}

function emit(task: Task, payload: unknown): void {
  task.events.push(JSON.stringify(payload))
}

export function markRunning(task: Task, projectId: number): void {
  const item = itemOf(task, projectId)
  if (!item) return
  item.state = 'running'
  emit(task, { type: 'item', item })
}

export function markDone(task: Task, projectId: number, result: unknown): void {
  const item = itemOf(task, projectId)
  if (!item) return
  item.state = 'done'
  item.result = result
  task.done += 1
  emit(task, { type: 'item', item, done: task.done, total: task.total })
}

export function markFailed(task: Task, projectId: number, message: string): void {
  const item = itemOf(task, projectId)
  if (!item) return
  item.state = 'failed'
  item.error = message
  task.done += 1
  emit(task, { type: 'item', item, done: task.done, total: task.total })
}

export function finish(task: Task, summary: Record<string, number>): void {
  task.status = 'done'
  task.finishedAt = Date.now()
  task.summary = summary
  emit(task, { type: 'finished', summary, total: task.total })
}

export function failTask(task: Task, message: string): void {
  task.status = 'failed'
  task.finishedAt = Date.now()
  task.error = message
  emit(task, { type: 'error', message })
}

function itemOf(task: Task, projectId: number): TaskItem | null {
  return task.items.find((i) => i.projectId === projectId) ?? null
}

/**
 * 清掉过期的任务，别让内存慢慢涨。
 *
 * 两条硬规矩：
 * 1. **不碰还在 running 的任务**。真实批量任务的耗时没有上限可言：
 *    MAX_BATCH=200 ÷ 并发 4 × 单命令超时 120s ≈ 100 分钟，远超这里 30 分钟的 TTL。
 *    按 createdAt 一刀切会把正在跑的任务从表里摘掉 —— 之后 `/updates/:taskId`
 *    与 SSE 入口都返回 404，前端进度彻底丢失，也没有任何取消路径。
 * 2. TTL 从**结束时间**开始算，不是创建时间。一个跑了 40 分钟的任务，
 *    刚出结果就被清掉，用户根本来不及看。
 */
function sweep(now = Date.now()): void {
  for (const [id, task] of tasks) {
    if (task.status === 'running') continue
    const since = task.finishedAt ?? task.createdAt
    if (now - since > TTL_MS) tasks.delete(id)
  }
}
