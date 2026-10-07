import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_BATCH_IDS } from '@git-nest/core'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

// 每个用例都要 init/clone 真实仓库，Windows 上单条 git 命令就要几百毫秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

/** 项目 id → 仓库目录 */
const dirs = new Map<number, string>()

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
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' })
const json = { 'content-type': 'application/json' }

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-updates-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

function commitIn(dir: string, message: string, file = 'f.txt') {
  fs.writeFileSync(path.join(dir, file), `${message}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', message)
}

async function addProject(name: string, dir: string, category = 'tools', isOwn = false) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name, path: dir, category, isOwn },
  })
  expect(res.statusCode).toBe(201)
  const id = res.json().project.id as number
  dirs.set(id, dir)
  return id
}

/** 后台任务要等它跑完：轮询任务快照。 */
async function waitForTask(taskId: string) {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/updates/${taskId}` })
    if (res.statusCode !== 200) throw new Error(`任务查不到：${taskId}`)
    const task = res.json()
    if (task.status !== 'running') return task
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('任务超时')
}

async function startCheck(ids?: number[]) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/updates/check',
    headers: json,
    payload: ids ? { ids } : {},
  })
  return res
}

function makeOriginWithClone(name: string, remoteCommits: number) {
  const origin = path.join(root, name)
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-b', 'main')
  commitIn(origin, '初始提交')
  for (let i = 0; i < remoteCommits; i++) commitIn(origin, `远程提交 ${i + 1}`)

  const clone = path.join(root, `${name}-clone`)
  git(root, 'clone', origin, `${name}-clone`)
  return { origin, clone }
}

describe('POST /api/updates/check', () => {
  it('发现落后并给出要拉进来的提交列表', async () => {
    const { origin, clone } = makeOriginWithClone('behind', 0)
    const id = await addProject('behind', clone)
    commitIn(origin, '远程新提交')

    const started = await startCheck([id])
    expect(started.statusCode).toBe(202)
    const task = await waitForTask(started.json().id)

    expect(task.status).toBe('done')
    const item = task.items[0]
    expect(item.state).toBe('done')
    expect(item.result.status).toBe('behind')
    expect(item.result.behind).toBe(1)
    expect(item.result.incoming[0].subject).toBe('远程新提交')
    expect(task.summary.behind).toBe(1)
  })

  it('结果写进 update_checks 历史', async () => {
    const { origin, clone } = makeOriginWithClone('history', 0)
    const id = await addProject('history', clone)
    commitIn(origin, '远程提交')
    await waitForTask((await startCheck([id])).json().id)

    const row = db
      .prepare('SELECT status, behind_count, detail FROM update_checks WHERE project_id = ?')
      .get(id) as { status: string; behind_count: number; detail: string }
    expect(row.status).toBe('behind')
    expect(row.behind_count).toBe(1)
    expect(JSON.parse(row.detail).incoming).toBe(1)

    // 列表页要能看到「最后检查时间」
    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    const project = list.json().projects.find((p: { id: number }) => p.id === id)
    expect(project.latestCheck.status).toBe('behind')
  })

  it('已是最新 → up_to_date', async () => {
    const { clone } = makeOriginWithClone('uptodate', 0)
    const id = await addProject('uptodate', clone)
    const task = await waitForTask((await startCheck([id])).json().id)
    expect(task.items[0].result.status).toBe('up_to_date')
    expect(task.summary.upToDate).toBe(1)
  })

  it('不联网的仓库（没有 origin）→ no_remote，不算失败', async () => {
    const dir = path.join(root, 'no-origin')
    fs.mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-b', 'main')
    commitIn(dir, '本地提交')
    const id = await addProject('no-origin', dir)

    const task = await waitForTask((await startCheck([id])).json().id)
    expect(task.items[0].result.status).toBe('no_remote')
    expect(task.items[0].state).toBe('done')
  })

  it('自己写的项目默认不参与检查，并说明跳过了谁', async () => {
    const { origin, clone } = makeOriginWithClone('own', 0)
    // 分类照样填 personal：现在它**不带任何行为**，判据是那个布尔
    const id = await addProject('my-own', clone, 'personal', true)
    commitIn(origin, '远程提交')

    const res = await startCheck([id])
    // 全是自己的项目 → 直接拒绝，而不是跑一遍再告诉你没结果
    expect(res.statusCode).toBe(400)

    // 打开设置后再试
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: json,
      payload: { includeOwn: true },
    })
    const ok = await startCheck([id])
    const task = await waitForTask(ok.json().id)
    expect(task.items[0].result.status).toBe('behind')

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: json,
      payload: { includeOwn: false },
    })
  })

  it('混合勾选时只查别人的，并列出跳过的', async () => {
    const mine = makeOriginWithClone('mixed-mine', 0)
    const theirs = makeOriginWithClone('mixed-theirs', 0)
    const mineId = await addProject('mine', mine.clone, 'tools', true)
    const theirsId = await addProject('theirs', theirs.clone)
    commitIn(mine.origin, '远程提交')
    commitIn(theirs.origin, '远程提交')

    const res = await startCheck([mineId, theirsId])
    const task = await waitForTask(res.json().id)

    expect(task.items).toHaveLength(1)
    expect(task.items[0].projectId).toBe(theirsId)
    expect(res.json().skipped).toEqual(['mine（我自己的）'])
  })

  it('不是仓库的目录 → not_a_repo，不影响其他仓库', async () => {
    const good = makeOriginWithClone('mixed-good', 0)
    commitIn(good.origin, '远程提交')
    const goodId = await addProject('good', good.clone)
    // 目录存在但不是仓库
    const plainDir = path.join(root, 'plain-dir')
    fs.mkdirSync(plainDir, { recursive: true })
    const plainId = await addProject('plain2', plainDir)

    const task = await waitForTask((await startCheck([goodId, plainId])).json().id)
    expect(task.status).toBe('done')
    expect(task.items).toHaveLength(2)
    const results = task.items.map((i: { result: { status: string } }) => i.result.status)
    expect(results).toContain('not_a_repo')
    expect(results).toContain('behind')
  })

  it('不给 ids 就检查全部非自己写的项目', async () => {
    const task = await waitForTask((await startCheck()).json().id)
    expect(task.status).toBe('done')
    expect(task.items.length).toBeGreaterThan(0)
    expect(task.items.every((i: { state: string }) => i.state === 'done')).toBe(true)
  })

  it('id 超过上限直接拒绝', async () => {
    // 上限集中在 core 的 limits.ts（前端读同一个常量，超了会提前拦下并说清原因）。
    // 这条用例从「超过 200 就拒」改成「超过 MAX_BATCH_IDS 就拒」，
    // 免得以后调上限时它变成一个**假绿**（201 个现在是被接受的）。
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      headers: json,
      payload: { ids: Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => i + 1) },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /api/updates/apply', () => {
  it('勾选后 ff-only 更新，并汇总结果', async () => {
    const { origin, clone } = makeOriginWithClone('apply', 0)
    const id = await addProject('apply-target', clone)
    commitIn(origin, '远程提交 1')
    commitIn(origin, '远程提交 2')

    // 先检查，让用户看到要拉什么
    await waitForTask((await startCheck([id])).json().id)

    const started = await app.inject({
      method: 'POST',
      url: '/api/updates/apply',
      headers: json,
      payload: { ids: [id] },
    })
    expect(started.statusCode).toBe(202)
    const task = await waitForTask(started.json().id)

    expect(task.items[0].result.outcome).toBe('updated')
    expect(task.items[0].result.newCommits).toBe(2)
    expect(task.summary).toMatchObject({ updated: 1, commits: 2, failed: 0, skipped: 0 })
    // 真的快进了：HEAD == origin/main，没有 merge commit
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(
      git(clone, 'rev-parse', 'origin/main').trim(),
    )
    expect(git(clone, 'rev-list', '--count', '--merges', 'HEAD').trim()).toBe('0')
  })

  it('上次检查判了「别拉」→ 服务端直接拒绝执行，连 pull 都不发', async () => {
    // 这道闸拦的是两种表象为 `behind` 的情况：作者 force push 改写了历史、
    // 或作者删库重建。前端已经把这类仓库的勾选框禁掉了，但那是建议——
    // 直接打这个接口绕得过去，所以服务端必须自己也拦一道。
    const { origin, clone } = makeOriginWithClone('apply-refused', 0)
    const id = await addProject('apply-refused', clone)
    commitIn(origin, '远程提交')

    // 造一条「上次检查」的记录：状态是 behind，判决是 rewritten
    db.prepare(
      `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      new Date(Date.now() - 60_000).toISOString(),
      'behind',
      0,
      1,
      JSON.stringify({ incoming: 1, outgoing: 0, tags: [], verdict: 'rewritten', canPull: false }),
    )
    const before = git(clone, 'rev-parse', 'HEAD').trim()

    const task = await waitForTask(
      (
        await app.inject({
          method: 'POST',
          url: '/api/updates/apply',
          headers: json,
          payload: { ids: [id] },
        })
      ).json().id,
    )

    const result = task.items[0].result
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toContain('别拉')
    expect(result.reason).toContain('改写过')
    expect(task.summary).toMatchObject({ skipped: 1, updated: 0, commits: 0 })
    // 真的没动：HEAD 原地不动，那个远程提交没进来
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(before)
    expect(git(clone, 'log', '-1', '--pretty=%s').trim()).not.toBe('远程提交')
    // 「上次检查」的时间也不该被这次拒绝覆盖（这一步没读到任何新事实）
    const last = db
      .prepare('SELECT status FROM update_checks WHERE project_id = ? ORDER BY id DESC LIMIT 1')
      .get(id) as { status: string }
    expect(last.status).toBe('behind')
  })

  it('已是最新 → already_up_to_date', async () => {
    const { clone } = makeOriginWithClone('apply-fresh', 0)
    const id = await addProject('apply-fresh', clone)
    const task = await waitForTask(
      (
        await app.inject({
          method: 'POST',
          url: '/api/updates/apply',
          headers: json,
          payload: { ids: [id] },
        })
      ).json().id,
    )
    expect(task.items[0].result.outcome).toBe('already_up_to_date')
    expect(task.summary.upToDate).toBe(1)
  })

  it('工作区脏 → 跳过并说清原因，不硬来', async () => {
    const { origin, clone } = makeOriginWithClone('apply-dirty', 0)
    const id = await addProject('apply-dirty', clone)
    commitIn(origin, '远程提交')
    fs.writeFileSync(path.join(clone, 'f.txt'), '还没提交\n')

    const task = await waitForTask(
      (
        await app.inject({
          method: 'POST',
          url: '/api/updates/apply',
          headers: json,
          payload: { ids: [id] },
        })
      ).json().id,
    )
    expect(task.items[0].result.outcome).toBe('skipped')
    expect(task.items[0].result.status).toBe('dirty')
    expect(task.summary.skipped).toBe(1)
  })

  it('已分叉 → 跳过，绝不产生 merge commit', async () => {
    const { origin, clone } = makeOriginWithClone('apply-diverge', 0)
    const id = await addProject('apply-diverge', clone)
    commitIn(clone, '本地提交')
    commitIn(origin, '远程提交')

    const task = await waitForTask(
      (
        await app.inject({
          method: 'POST',
          url: '/api/updates/apply',
          headers: json,
          payload: { ids: [id] },
        })
      ).json().id,
    )
    expect(task.items[0].result.status).toBe('diverged')
    expect(task.summary.skipped).toBe(1)
  })

  it('一部分失败不影响其他仓库', async () => {
    const good = makeOriginWithClone('apply-good', 0)
    const goodId = await addProject('apply-good', good.clone)
    commitIn(good.origin, '远程提交')

    const broken = path.join(root, 'apply-broken')
    fs.mkdirSync(broken, { recursive: true })
    git(broken, 'init', '-b', 'main')
    commitIn(broken, '本地提交')
    git(broken, 'remote', 'add', 'origin', 'https://no-such-host.invalid/x.git')
    const brokenId = await addProject('apply-broken', broken)

    const task = await waitForTask(
      (
        await app.inject({
          method: 'POST',
          url: '/api/updates/apply',
          headers: json,
          payload: { ids: [goodId, brokenId] },
        })
      ).json().id,
    )

    interface Item {
      projectId: number
      result?: { outcome: string }
    }
    const byId = new Map<number, Item>(
      (task.items as Item[]).map((i) => [i.projectId, i]),
    )
    expect(byId.get(goodId)?.result?.outcome).toBe('updated')
    expect(byId.get(brokenId)?.result?.outcome).toBe('failed')
    expect(task.summary).toMatchObject({ updated: 1, failed: 1 })
  })

  it('ids 为空 → 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/apply',
      headers: json,
      payload: { ids: [] },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('任务与设置', () => {
  it('不存在的任务返回 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/updates/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })

  it('设置能读能改', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(before.json().settings).toMatchObject({ includeOwn: false, concurrency: 4 })

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: json,
      payload: { concurrency: 8, gitTimeoutMs: 30_000 },
    })
    expect(patched.json().settings).toMatchObject({ concurrency: 8, gitTimeoutMs: 30_000 })

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: json,
      payload: { concurrency: 999 },
    })
    expect(bad.statusCode).toBe(422)

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: json,
      payload: { concurrency: 4, gitTimeoutMs: 120_000 },
    })
  })
})
