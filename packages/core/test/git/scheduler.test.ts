import { describe, expect, it } from 'vitest'
import { Scheduler } from '../../src/git/scheduler.ts'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 记录并发峰值，用来验证闸门真的在限流。 */
function makeTracker() {
  let active = 0
  let peak = 0
  return {
    get peak() {
      return peak
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      active += 1
      peak = Math.max(peak, active)
      try {
        return await task()
      } finally {
        active -= 1
      }
    },
  }
}

describe('Scheduler', () => {
  it('同一个 key 的任务严格串行', async () => {
    const scheduler = new Scheduler()
    const tracker = makeTracker()
    const order: string[] = []

    const task = (name: string, ms: number) => () =>
      tracker.run(async () => {
        order.push(`${name}:start`)
        await delay(ms)
        order.push(`${name}:end`)
        return name
      })

    const results = await Promise.all([
      scheduler.schedule('repo-a', task('a1', 20)),
      scheduler.schedule('repo-a', task('a2', 1)),
      scheduler.schedule('repo-a', task('a3', 1)),
    ])

    expect(results).toEqual(['a1', 'a2', 'a3'])
    // 关键：a1 必须先跑完，a2 才能开始
    expect(order).toEqual(['a1:start', 'a1:end', 'a2:start', 'a2:end', 'a3:start', 'a3:end'])
    expect(tracker.peak).toBe(1)
  })

  it('不同 key 并发，但不超过上限', async () => {
    const scheduler = new Scheduler({ concurrency: 3 })
    const tracker = makeTracker()

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        scheduler.schedule(`repo-${i}`, () => tracker.run(() => delay(10).then(() => i))),
      ),
    )

    expect(tracker.peak).toBe(3)
  })

  it('前面的任务失败不挡住后面的任务', async () => {
    const scheduler = new Scheduler()

    const failed = scheduler.schedule('repo-x', async () => {
      throw new Error('boom')
    })
    const next = scheduler.schedule('repo-x', async () => 'ok')

    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })

  it('map 批量执行，keyOf 决定串行分组', async () => {
    const scheduler = new Scheduler({ concurrency: 2 })
    const tracker = makeTracker()

    const results = await scheduler.map(
      ['a', 'b', 'a', 'b'],
      (item) => item,
      async (item) => tracker.run(() => delay(5).then(() => item.toUpperCase())),
    )

    expect(results).toEqual(['A', 'B', 'A', 'B'])
    expect(tracker.peak).toBe(2)
  })

  /*
    「同仓库串行」靠的是 key 相等。而同一个仓库可以有很多种写法
    （`D:\repo`、`D:/repo`、`D:/repo/`、大小写不同）——调用方不保证归一，
    core 是公开 API，不能把「调用方一定归一过」当隐含前提。
    原来原样当 key：两种写法各自并发跑同一个仓库，正是要防的 index.lock 竞争。
  */
  it('同一个仓库的不同写法算同一个 key（Windows 上）', async () => {
    const scheduler = new Scheduler()
    const order: string[] = []
    const task = (name: string, ms: number) => async () => {
      order.push(`${name}:start`)
      await delay(ms)
      order.push(`${name}:end`)
    }

    await Promise.all([
      scheduler.schedule('D:\\Git\\repo\\', task('a', 20)),
      scheduler.schedule('d:/git/repo', task('b', 1)),
    ])

    // 串行 = a 跑完 b 才开始；若被当成两个 key，b 会先结束
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })
})
