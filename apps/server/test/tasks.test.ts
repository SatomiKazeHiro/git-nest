import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTask, finish, getTask, taskSnapshot } from '../src/lib/tasks.ts'

/**
 * 任务生命周期。这一块原来只有「在 createTask 里扫一次、按 createdAt 判过期」，
 * 于是**正在运行**的任务会被删掉：批量检查的理论上限约 100 分钟
 * （MAX_BATCH=200 ÷ 并发 4 × 单命令超时 120s），远超 30 分钟的 TTL。
 * 任务被从表里摘掉后，后台还在跑、还在写库，但 `/updates/:taskId` 与 SSE
 * 入口都返回 404，前端进度彻底丢失，也没有取消路径。
 *
 * 这里用假时钟推进时间，不真的等 30 分钟。
 */

const THIRTY_ONE_MIN = 31 * 60_000

afterEach(() => {
  vi.useRealTimers()
})

describe('任务清扫', () => {
  it('还在运行的任务不会被清掉（哪怕创建很久了）', () => {
    const running = createTask('check', [{ id: 1, name: 'a' }])

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + THIRTY_ONE_MIN)
    // 触发一次清扫（createTask 内部会 sweep）
    createTask('check', [{ id: 2, name: 'b' }])

    expect(getTask(running.id)).not.toBeNull()
    expect(taskSnapshot(getTask(running.id)!).status).toBe('running')
    vi.useRealTimers()
  })

  it('TTL 从结束时间算：跑很久的任务刚结束时不能被立刻清掉', () => {
    vi.useFakeTimers()
    const started = Date.now()

    const long = createTask('check', [{ id: 1, name: 'a' }])
    // 让它「跑」了 40 分钟才结束
    vi.setSystemTime(started + 40 * 60_000)
    finish(long, { behind: 1 })

    // 刚结束，立刻触发清扫：必须留着
    createTask('check', [{ id: 2, name: 'b' }])
    expect(getTask(long.id)).not.toBeNull()

    // 再往后推过 TTL，才允许清掉
    vi.setSystemTime(Date.now() + THIRTY_ONE_MIN)
    createTask('check', [{ id: 3, name: 'c' }])
    expect(getTask(long.id)).toBeNull()

    vi.useRealTimers()
  })

  it('已结束的任务过了 TTL 才清', () => {
    vi.useFakeTimers()
    const task = createTask('check', [{ id: 1, name: 'a' }])
    finish(task, { behind: 0 })

    // 29 分钟：还在
    vi.setSystemTime(Date.now() + 29 * 60_000)
    createTask('check', [{ id: 2, name: 'b' }])
    expect(getTask(task.id)).not.toBeNull()

    // 再过 2 分钟（合计 31）：清掉
    vi.setSystemTime(Date.now() + 2 * 60_000)
    createTask('check', [{ id: 3, name: 'c' }])
    expect(getTask(task.id)).toBeNull()

    vi.useRealTimers()
  })
})
