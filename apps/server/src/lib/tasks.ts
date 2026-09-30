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

export function getTask(id: string): Task | null {
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

/** 半小时前的任务没人看了，清掉，别让内存慢慢涨。 */
function sweep(): void {
  const now = Date.now()
  for (const [id, task] of tasks) {
    if (now - task.createdAt > TTL_MS) tasks.delete(id)
  }
}
