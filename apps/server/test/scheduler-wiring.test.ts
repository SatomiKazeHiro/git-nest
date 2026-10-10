import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Scheduler } from '@git-nest/core/git'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

// 每个用例都要 init/clone 真实仓库，Windows 上单条 git 命令就要几百毫秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * 这一组守的是一个真实 bug：`Scheduler` 的同仓库队列是**实例私有**的。
 *
 * server 侧在 `lib/git.ts` 里建了一个「并发上限可调」的 scheduler，状态查询确实用它；
 * 但批量 check / apply 与目录扫描当时直接调 core 函数、没把 scheduler 传下去，
 * 于是落到 core 的 `defaultScheduler`（并发写死 4）。后果有两个，都很实在：
 *   1. 同一个仓库上 `pull --ff-only`（写工作区）与 `git status`（读 refs）可以并发
 *      —— 正是核心不变量要防的 index.lock / refs 竞争；
 *   2. 设置页里的 concurrency 对 check / apply / scan 完全无效。
 *
 * 观测手段：注入一个会计数的 Scheduler，然后看**这个仓库的实际路径**有没有被调度过。
 * 走 server 的 scheduler 就会留下记录；忽略它而用 core 的默认实例则一条都没有。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

class CountingScheduler extends Scheduler {
  readonly keys: string[] = []

  override schedule<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.keys.push(key)
    return super.schedule(key, task)
  }

  /** 这个目录被调度过几次（路径统一成正斜杠再比） */
  countForDirectory(dir: string): number {
    const needle = dir.replace(/\\/g, '/')
    return this.keys.filter((k) => k.replace(/\\/g, '/') === needle).length
  }
}

const scheduler = new CountingScheduler({ concurrency: 4 })
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
  '-c',
  'core.autocrlf=false',
]
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' })

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-sched-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false, scheduler }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

function commitIn(dir: string, message: string) {
  fs.writeFileSync(path.join(dir, 'f.txt'), `${message}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', message)
}

/** origin + clone，clone 落后 origin 若干提交（不 fetch）。返回 clone 的绝对路径。 */
function makeClone(behindBy = 0): string {
  const origin = path.join(root, `origin-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-b', 'main')
  commitIn(origin, '初始提交')
  for (let i = 0; i < behindBy; i++) commitIn(origin, `远程提交 ${i + 1}`)

  const clone = `${origin}-clone`
  git(root, 'clone', origin, clone)
  return fs.realpathSync(clone)
}

async function addProject(name: string, dir: string) {
  return app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name, path: dir, category: 'tools' },
  })
}

/** 批量任务在后台跑，轮询快照直到收尾，返回终态快照。 */
async function waitForTask(taskId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: `/api/updates/${taskId}` })
    if (res.statusCode === 200 && res.json().status !== 'running') return res.json()
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`任务 ${taskId} 在 ${timeoutMs}ms 内没结束`)
}

describe('批量路径必须复用 server 的 scheduler', () => {
  it('updates/check 会走注入的 scheduler', async () => {
    const clone = makeClone(1)
    const created = await addProject('check-target', clone)
    expect(created.statusCode).toBe(201)

    const before = scheduler.countForDirectory(clone)
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      headers: json,
      payload: { ids: [created.json().project.id] },
    })
    expect(res.statusCode).toBe(202)

    const task = await waitForTask(res.json().id)
    // 先确认任务真的干了活：如果它整批失败，下面的计数断言就没意义
    expect(task.status).toBe('done')
    expect(task.items[0].state).toBe('done')

    expect(scheduler.countForDirectory(clone)).toBeGreaterThan(before)
  })

  it('updates/apply 会走注入的 scheduler', async () => {
    const clone = makeClone(1)
    const created = await addProject('apply-target', clone)
    expect(created.statusCode).toBe(201)

    const before = scheduler.countForDirectory(clone)
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/apply',
      headers: json,
      payload: { ids: [created.json().project.id] },
    })
    expect(res.statusCode).toBe(202)

    const task = await waitForTask(res.json().id)
    expect(task.status).toBe('done')
    expect(task.items[0].state).toBe('done')

    expect(scheduler.countForDirectory(clone)).toBeGreaterThan(before)
  })

  it('scan 会走注入的 scheduler', async () => {
    const scanRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-scan-')))
    const clone = makeClone(0)
    const moved = path.join(scanRoot, 'a-repo')
    fs.renameSync(clone, moved)

    const res = await app.inject({
      method: 'POST',
      url: '/api/scan',
      headers: json,
      payload: { dir: scanRoot },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().found).toHaveLength(1)

    expect(scheduler.countForDirectory(fs.realpathSync(moved))).toBeGreaterThan(0)
    fs.rmSync(scanRoot, { recursive: true, force: true })
  })
})
