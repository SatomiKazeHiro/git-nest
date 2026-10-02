import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { getRepoStatus } from '@git-nest/core/git'

/**
 * M5：Windows 兼容与异常场景。
 * 这里的路径都故意造得难受：长路径、中文、空格、以及一个会回 401 的假远程。
 */

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string
let authServer: http.Server
let authPort: number

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
const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST' as const, url, headers: json, payload: payload as object })

function makeRepo(dir: string, opts: { remote?: boolean; readme?: string } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    opts.readme ?? `# ${path.basename(dir)}\n\n说明。\n`,
    'utf8',
  )
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x\n', 'utf8')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', '初始提交')
  if (opts.remote !== false) {
    git(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git')
  }
  return dir
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-m5-')))

  // 一个只会回 401 的假远程：git 会因此要求输入用户名，
  // 我们禁掉了交互，于是它应该快速失败并被归因成 auth
  authServer = http.createServer((_req, res) => {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="git"', 'content-type': 'text/plain' })
    res.end('Unauthorized')
  })
  await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve))
  authPort = (authServer.address() as { port: number }).port

  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(async () => {
  db.close()
  await new Promise<void>((resolve) => authServer.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

async function addProject(name: string, dir: string) {
  const res = await post('/api/projects', { name, path: dir })
  expect(res.statusCode).toBe(201)
  return res.json().project.id as number
}

describe('Windows 路径', () => {
  it('带空格与中文的路径能用', async () => {
    const dir = makeRepo(path.join(root, '我的 仓库', 'canvas editor'))
    const id = await addProject('中文路径', dir)

    const status = await app.inject({ method: 'GET', url: `/api/projects/${id}/status?fresh=true` })
    expect(status.statusCode).toBe(200)
    expect(status.json().status).toMatchObject({ isRepo: true, branch: 'main' })

    const log = await app.inject({ method: 'GET', url: `/api/projects/${id}/log` })
    expect(log.json().entries[0].subject).toBe('初始提交')

    // 入库时存的是正斜杠形式，不会带着反斜杠和转义
    const list = await app.inject({ method: 'GET', url: '/api/projects?q=中文路径' })
    expect(list.json().projects[0].path).not.toContain('\\')
  })

  it('接近上限的深路径能正常用', async () => {
    // Windows MAX_PATH 约 260；这个控制在 ~200，留足余量
    let dir = root
    const chunk = 'deep-dir'
    for (let i = 0; i < 6; i++) dir = path.join(dir, `${chunk}-${i}`)
    expect(dir.length).toBeLessThan(240)

    const repo = makeRepo(dir)
    const id = await addProject('deep-path', repo)

    const status = await app.inject({ method: 'GET', url: `/api/projects/${id}/status?fresh=true` })
    expect(status.json().status).toMatchObject({ isRepo: true, branch: 'main' })
    expect(status.json().status.lastCommit.subject).toBe('初始提交')
  })

  it('超过上限的路径：说清是路径太长，而不是「不是 git 仓库」', async () => {
    let dir = root
    const chunk = 'very-long-directory-name-to-exceed-max-path'
    for (let i = 0; i < 6; i++) dir = path.join(dir, `${chunk}-${i}`)
    expect(dir.length).toBeGreaterThan(260)
    fs.mkdirSync(dir, { recursive: true }) // 目录能建，只是 git 进不去

    const status = await getRepoStatus(dir, { timeoutMs: 15_000 })
    expect(status.error?.kind).toBe('path_too_long')
    expect(status.status).not.toBe('not_a_repo')
    // 文案要与**触发门槛**一致（代码里是 240，比 MAX_PATH 约 260 保守一截），
    // 而且要给可操作的出路 —— 原来消息说「约 260」却按 240 触发，自相矛盾。
    expect(status.error?.message).toContain('240')
    expect(status.error?.message).toContain('LongPathsEnabled')
  })

  it('扫描能认出带中文与长路径的仓库', async () => {
    const parent = path.join(root, '扫描 目标')
    makeRepo(path.join(parent, '仓库 A'))
    makeRepo(path.join(parent, '仓库 B'))

    const res = await post('/api/scan', { dir: parent })
    expect(res.statusCode).toBe(200)
    expect(res.json().found.map((r: { name: string }) => r.name).sort()).toEqual(['仓库 A', '仓库 B'])
  })
})

describe('凭证与网络', () => {
  it('远程要密码时快速失败并归因成 auth（不弹窗、不挂死）', async () => {
    const dir = makeRepo(path.join(root, 'needs-auth'), { remote: false })
    git(dir, 'remote', 'add', 'origin', `http://127.0.0.1:${authPort}/private.git`)
    const id = await addProject('needs-auth', dir)

    const started = Date.now()
    const res = await post('/api/updates/check', { ids: [id] })
    expect(res.statusCode).toBe(202)
    const taskId = res.json().id as string

    let task = null
    for (let i = 0; i < 100; i++) {
      const poll = await app.inject({ method: 'GET', url: `/api/updates/${taskId}` })
      task = poll.json()
      if (task.status !== 'running') break
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(task?.status).toBe('done')
    // 没有挂死：整个检查在超时之前就结束了
    expect(Date.now() - started).toBeLessThan(30_000)

    const result = task.items[0].result
    expect(result.status).toBe('error')
    expect(result.error.kind).toBe('auth')
    // 提示要用户自己去终端认证，而不是让 git-nest 收密码
    expect(result.error.message).toContain('gh auth login')
  })

  it('远程仓库不存在时说的是「找不到」，不是「要认证」', async () => {
    const dir = makeRepo(path.join(root, 'no-such-remote'), { remote: false })
    git(dir, 'remote', 'add', 'origin', 'https://github.com/this-org-does-not-exist-xyz-000/x.git')

    const { classifyError } = await import('@git-nest/core/git')
    const err = classifyError({
      code: 128,
      stdout: '',
      stderr: "fatal: repository 'https://github.com/this-org-does-not-exist-xyz-000/x.git/' not found",
      timedOut: false,
      message: 'fetch 失败',
    })
    expect(err.kind).not.toBe('auth')
    expect(err.message).toContain('找不到')
    void dir
  })
})

describe('仓库被移走之后', () => {
  it('状态变 missing，记录仍在，能改路径指到新位置', async () => {
    const parent = path.join(root, 'moving')
    const oldDir = makeRepo(path.join(parent, 'old-name'))
    const id = await addProject('moved', oldDir)

    const before = await app.inject({ method: 'GET', url: `/api/projects/${id}/status?fresh=true` })
    expect(before.json().status.isRepo).toBe(true)

    // 模拟用户在磁盘上把仓库搬走了
    const newDir = path.join(parent, 'new-name')
    fs.renameSync(oldDir, newDir)

    const missing = await app.inject({ method: 'GET', url: `/api/projects/${id}/status?fresh=true` })
    expect(missing.json().status).toMatchObject({ status: 'missing', isRepo: false })

    // 记录没有被自动删掉
    const still = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(still.statusCode).toBe(200)
    expect(still.json().project.name).toBe('moved')

    // 改路径指到新位置，之后状态恢复正常
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: json,
      payload: { path: newDir },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().project.path).not.toContain('\\')

    const after = await app.inject({ method: 'GET', url: `/api/projects/${id}/status?fresh=true` })
    expect(after.json().status).toMatchObject({ isRepo: true, branch: 'main' })
  })

  it('改路径时校验：目录必须存在、不能和别的项目撞', async () => {
    const a = makeRepo(path.join(root, 'ptr-a'))
    const b = makeRepo(path.join(root, 'ptr-b'))
    const aId = await addProject('ptr-a', a)
    await addProject('ptr-b', b)

    const missingDir = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${aId}`,
      headers: json,
      payload: { path: path.join(root, 'no-such-dir-here') },
    })
    expect(missingDir.statusCode).toBe(400)
    expect(missingDir.json().message).toContain('目录不存在')

    const clash = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${aId}`,
      headers: json,
      payload: { path: b },
    })
    expect(clash.statusCode).toBe(409)

    // 自己指给自己不算撞
    const self = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${aId}`,
      headers: json,
      payload: { path: a, record: '同一路径改了记录' },
    })
    expect(self.statusCode).toBe(200)
    expect(self.json().project.record).toBe('同一路径改了记录')
  })
})

describe('批量操作的部分失败', () => {
  it('一半仓库坏了，其余照常跑完并按四类汇总', async () => {
    const good = makeRepo(path.join(root, 'batch-good'))
    const origin = makeRepo(path.join(root, 'batch-origin'), { remote: false })
    git(origin, 'remote', 'add', 'origin', `http://127.0.0.1:${authPort}/x.git`)
    const plainDir = path.join(root, 'batch-plain')
    fs.mkdirSync(plainDir, { recursive: true })

    const goodId = await addProject('batch-good', good)
    const authId = await addProject('batch-auth', origin)
    const plainId = await addProject('batch-plain', plainDir)

    const started = await post('/api/updates/check', {
      ids: [goodId, authId, plainId],
    })
    expect(started.statusCode).toBe(202)

    let task = null
    for (let i = 0; i < 100; i++) {
      const poll = await app.inject({ method: 'GET', url: `/api/updates/${started.json().id}` })
      task = poll.json()
      if (task.status !== 'running') break
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(task.status).toBe('done')
    interface Item {
      projectId: number
      result?: { status: string; error?: { kind: string } }
    }
    const byId = new Map<number, Item>(
      (task.items as Item[]).map((i) => [i.projectId, i]),
    )
    // 远程地址不存在 → 归因成 network
    expect(byId.get(goodId)?.result?.status).toBe('error')
    expect(byId.get(goodId)?.result?.error?.kind).toBe('network')
    expect(byId.get(authId)?.result?.error?.kind).toBe('auth')
    expect(byId.get(plainId)?.result?.status).toBe('not_a_repo')

    // 三个都有结论，没有一个卡在 pending/running
    expect(task.items.every((i: { state: string }) => i.state === 'done')).toBe(true)
    const summary = (task.summary ?? {}) as Record<string, number>
    const sum = Object.values(summary).reduce((a: number, b: number) => a + b, 0)
    expect(sum).toBe(3)
  })
})

describe('锁文件残留', () => {
  it('index.lock 残留时：要么能读，要么报错必须说清是锁的问题', async () => {
    // 归因映射本身在 packages/core/test/git/errors.test.ts 里单独测过；
    // 这条测的是**真实场景**：残留一个 index.lock 之后 git 到底还读不读得出来。
    //
    // 原来这里是 `if (status.error) { ... }` —— 没有 error 时零断言通过，
    // 永远不会失败（审计指出的假绿）。现在两个分支都显式断言。
    const { getRepoStatus } = await import('@git-nest/core/git')
    const dir = makeRepo(path.join(root, 'locked'))
    fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '', 'utf8')

    const status = await getRepoStatus(dir, { timeoutMs: 10_000 })

    if (status.error) {
      // 只读命令通常不被锁挡住，被挡住了就必须说清是锁 + 怎么办
      expect(status.error.kind).toBe('locked')
      expect(status.error.message).toContain('index.lock')
    } else {
      // 没被挡住也是合法结果，但得真的读出了东西（不能是「没报错也没数据」）
      expect(status.isRepo).toBe(true)
      expect(status.branch).toBe('main')
      // makeRepo 造的是「有远程、没上游」的仓库，所以是 no_upstream 而不是 up_to_date
      expect(status.status).toBe('no_upstream')
      expect(status.lastCommit).not.toBeNull()
    }
  })
})
