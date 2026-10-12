import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

/**
 * 「不给 ids → 检查全部非自己写的项目」。
 *
 * ## 为什么它单独一个文件（原来在 `updates.test.ts` 里）
 *
 * 1. 它说的是「**当时库里全部**非自己写的项目」。留在 `updates.test.ts` 里，这句话
 *    就等于「前面用例攒下的所有项目」：单跑（`-t`）时库里一个项目都没有 → 服务端回
 *    400 → `json().id` 是 undefined，必红；全量并行跑时又要一口气查十几个仓库，
 *    于是撞上 `waitForTask` 的等待上限（14 秒那次）。
 * 2. 要让它自足，就得有一个**只有它自己那两个项目**的库。而**不能在同一个文件里
 *    另建一个 app**——这条路是实测踩出来的：`buildApp()` 有全局副作用，它调用
 *    `lib/git.ts` 的 `bindSettings(db)`，把 git 层读设置的那份引用**重绑**到新库上；
 *    新库一关，同一文件里后面所有走 git 的用例（`addProject` → `getRemoteUrl`）就
 *    全都 500 了（上一版的 `updates.test.ts` 里 6 条 apply 用例正是这么红的）。
 *    **换成独立文件才安全**：每个测试文件有自己的模块注册表（vitest 默认
 *    `isolate: true`），这里的 `bindSettings` 只作用于本文件那个实例，碰不到别人。
 *
 * 所以这个文件从头自己搭：自己的临时目录、自己的内存库、自己的 app；测试数据也
 * 只有它自己建的两个项目——`-t` 单跑与整文件跑，看到的是同一件事。
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

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
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' })

function commitIn(dir: string, message: string, file = 'f.txt') {
  fs.writeFileSync(path.join(dir, file), `${message}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', message)
}

/** 一个 origin + 一份 clone（clone 落后 origin 若干提交）。 */
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

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-batch-all-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

async function addProject(name: string, dir: string, isOwn: boolean) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name, path: dir, category: 'tools', isOwn },
  })
  expect(res.statusCode).toBe(201)
  return res.json().project.id as number
}

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

describe('POST /api/updates/check · 不给 ids', () => {
  it('检查全部非自己写的项目（自己的一个都不查）', async () => {
    const { clone: mineDir } = makeOriginWithClone('mine', 0)
    const { clone: theirsDir } = makeOriginWithClone('theirs', 0)
    const mineId = await addProject('mine', mineDir, true)
    const theirsId = await addProject('theirs', theirsDir, false)

    const started = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      headers: json,
      payload: {},
    })
    expect(started.statusCode).toBe(202)

    const task = await waitForTask(started.json().id)
    expect(task.status).toBe('done')
    // 「全部」= 非自己写的那些：别人的在、自己的不在（这才是这条用例要说的事）
    expect(task.items.map((i: { projectId: number }) => i.projectId)).toEqual([theirsId])
    expect(task.items.some((i: { projectId: number }) => i.projectId === mineId)).toBe(false)
    expect(task.items.every((i: { state: string }) => i.state === 'done')).toBe(true)
  })
})
