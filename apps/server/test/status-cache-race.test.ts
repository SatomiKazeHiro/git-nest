import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Scheduler } from '@git-nest/core/git'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { clearStatusCache } from '../src/lib/git.ts'

// 每个用例都要建真仓库，Windows 上单条 git 命令几百毫秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * `GET /api/status?ids=` 的一条真实竞态。
 *
 * `repoStatuses` 只对**缓存未命中**的路径去跑 git，然后 await；等它回来时，
 * 缓存里「刚才命中」的那部分可能已经被 `clearStatusCache()` 清掉了
 * —— 改设置、改/删项目、以及任一批量任务收尾都会清。
 * 原实现最后用 `statusCache.get(p)!.value` 组装返回值：`!` 让 tsc 闭嘴，
 * 运行时却会抛 TypeError，被全局错误处理器兜成 500。
 *
 * 触发点必须是确定的，不能靠并发碰运气：这里包住注入的 scheduler，
 * 在它执行 git 活的那个 await 窗口里同步清一次缓存 —— 这正是另一个请求
 * （或任务收尾）在现实中做的事。清缓存本身走的是产品代码里的真实导出。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string
const ids: number[] = []

const json = { 'content-type': 'application/json' }
const GIT = [
  '-c',
  'user.email=dev@git-nest.test',
  '-c',
  'user.name=test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
]
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...GIT, ...args], { cwd })

/** 只在前 N 次 schedule 后清缓存，避免影响建仓库阶段 */
let clearAfterSchedules = -1
let schedulesSeen = 0

class CacheClearingScheduler extends Scheduler {
  override schedule<T>(key: string, task: () => Promise<T>): Promise<T> {
    return super.schedule(key, async () => {
      const value = await task()
      schedulesSeen += 1
      if (clearAfterSchedules >= 0 && schedulesSeen === clearAfterSchedules) {
        // 模拟「另一个请求在这段 await 期间清空了缓存」
        clearStatusCache()
      }
      return value
    })
  }
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-statusrace-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false, scheduler: new CacheClearingScheduler({ concurrency: 4 }) }).app

  for (let i = 0; i < 6; i++) {
    const dir = path.join(root, `race-${i}`)
    fs.mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'f.txt'), `race-${i}\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', '初始提交')

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: `race-${i}`, path: dir },
    })
    expect(res.statusCode).toBe(201)
    ids.push(res.json().project.id as number)
  }
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('GET /api/status 与清缓存并发', () => {
  it('await 窗口里缓存被清掉时，仍返回可用状态而不是 500', async () => {
    // 先把前 3 个查热 → 下次请求里它们是「缓存命中」，后 3 个是「未命中」
    const warm = await app.inject({
      method: 'GET',
      url: `/api/status?ids=${ids.slice(0, 3).join(',')}`,
    })
    expect(warm.statusCode).toBe(200)

    // 后 3 个仓库的第一个 git 活跑完时清缓存：此刻前 3 个只在缓存里，
    // 而缓存刚被清空 —— 正是原实现会读到 undefined 的那一刻
    schedulesSeen = 0
    clearAfterSchedules = 1

    const res = await app.inject({ method: 'GET', url: `/api/status?ids=${ids.join(',')}` })

    clearAfterSchedules = -1

    expect(res.statusCode).toBe(200)
    const body = res.json() as { statuses: { projectId: number; status: unknown }[] }
    expect(body.statuses).toHaveLength(6)
    for (const entry of body.statuses) {
      expect(entry.status, `项目 ${entry.projectId} 的状态不能是空的`).toBeTruthy()
      expect((entry.status as { path?: string }).path).toBeTypeOf('string')
    }
  })
})
