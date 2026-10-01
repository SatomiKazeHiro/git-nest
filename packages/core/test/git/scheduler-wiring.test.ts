import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Scheduler } from '../../src/git/scheduler.ts'
import { analyzeUpdates } from '../../src/git/log.ts'
import { pullRepo } from '../../src/git/pull.ts'
import { getRepoStatus } from '../../src/git/status.ts'
import { scanDirectory } from '../../src/git/scan.ts'
import { cleanup, commit, initClone, initRepo, tempDir } from '../helpers/repo.ts'

/**
 * 这些用例守的是 server 侧的一个真实 bug：`Scheduler` 的 per-repo 队列（chains）
 * 是**实例私有**的。批量检查/更新如果不把 server 那个实例传下来，
 * 就会落到 core 的 `defaultScheduler`，于是「同仓库串行」在真实并发下不成立
 * —— `pull --ff-only` 正在写工作区时，同一个仓库的 `git status` 可以同时在跑。
 *
 * 观测点必须放在调度器**真正开始执行任务**的那一刻（`limited` 里），
 * 而不是调用方包一层：调用方的包装会在 `await` 之前同步进入，
 * 量到的是「发起了几次调用」而不是「几件事在同时跑」。
 */

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

/** 记录每个 key 上「同时真正在执行」的任务数峰值。 */
class ObservingScheduler extends Scheduler {
  readonly running = new Map<string, number>()
  peak = 0

  override schedule<T>(key: string, task: () => Promise<T>): Promise<T> {
    return super.schedule(key, async () => {
      const now = (this.running.get(key) ?? 0) + 1
      this.running.set(key, now)
      this.peak = Math.max(this.peak, now)
      try {
        return await task()
      } finally {
        this.running.set(key, (this.running.get(key) ?? 1) - 1)
      }
    })
  }
}

describe('core 入口接受外部 scheduler', () => {
  it('analyzeUpdates 对同一仓库的两批工作会被外部 scheduler 串行', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    track(origin)

    const scheduler = new ObservingScheduler({ concurrency: 4 })

    // 不能自己再套一层 scheduler.schedule(clone, ...)：这些入口内部已经对同一个 key
    // 排队了，外层再套一次就会自锁（STATUS.md 警告过的那条）。
    await Promise.all([
      analyzeUpdates(clone, { scheduler }),
      analyzeUpdates(clone, { scheduler }),
    ])

    // 若 analyzeUpdates 忽略传入的 scheduler，两次调用各自用 defaultScheduler → 峰值 2
    expect(scheduler.peak).toBe(1)
  })

  it('getRepoStatus / analyzeUpdates / pullRepo 混跑时共用同一个 scheduler', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    track(origin)

    const scheduler = new ObservingScheduler({ concurrency: 4 })

    // 刻意把三种操作混在一起：这正是「检查更新跑着的同时翻详情页」的形态
    await Promise.all([
      getRepoStatus(clone, { scheduler }),
      analyzeUpdates(clone, { scheduler }),
      pullRepo(clone, { scheduler }),
    ])

    expect(scheduler.peak).toBe(1)
  })

  it('pullRepo 在外部 scheduler 下不会和自己的 fetch 撞锁', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交 1')
    commit(origin, '远程提交 2')
    track(origin)

    const scheduler = new ObservingScheduler({ concurrency: 4 })
    const results = await Promise.all([
      pullRepo(clone, { scheduler }),
      pullRepo(clone, { scheduler }),
    ])

    for (const result of results) expect(result.outcome).not.toBe('failed')
    expect(results.some((r) => r.outcome === 'updated')).toBe(true)
  })

  it('scanDirectory 用传入的 scheduler 跑每个仓库（并发上限被采纳）', async () => {
    const root = track(tempDir())
    // 造 8 个平级仓库：比默认并发（4）多，忽略 scheduler 时峰值会是 4
    for (let i = 0; i < 8; i++) {
      const repo = track(initRepo(`提交 ${i}`))
      fs.renameSync(repo, path.join(root, `repo-${i}`))
    }

    const scheduler = new ObservingScheduler({ concurrency: 1 })
    const result = await scanDirectory(root, { scheduler, timeoutMs: 30_000 })

    expect(result.found).toHaveLength(8)
    // concurrency=1：8 个仓库必须一个一个来
    expect(scheduler.peak).toBe(1)
  })
})
