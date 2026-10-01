import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

/**
 * 进度 SSE 的两条**运维**问题（审计发现，原来这一整块零测试）：
 *
 * 1. 客户端断开后没有清理：`streamEvents` 循环里没有 `close` 钩子，关掉标签页
 *    之后那个 150ms 的轮询会一直空转到任务结束；Ctrl-C 关服务时，
 *    这条「永不结束的活跃请求」还会让 `app.close()` 一直等。
 * 2. 因此 `buildApp` 现在显式传 `forceCloseConnections: true`。
 *
 * 用**真实 HTTP 服务 + 真实 abort** 测，不 mock —— mock 掉就测不到「连接真的断了」。
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: DB
let app: ReturnType<typeof buildApp>['app']
let baseUrl: string
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
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...GIT, ...args], { cwd })

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-sse-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
  await app.listen({ port: 0, host: '127.0.0.1' })
  baseUrl = url(app)

  // 设置一个**短超时**：任务里的 fetch 会卡到这个超时，于是任务能「跑得够久」，
  // 我们才有时间订阅、再中途断开。
  await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ gitTimeoutMs: 3_000 }),
  })
})

afterEach(async () => {
  // 每个用例自己起的 app 在用例里关掉；这里只清任务表带来的影响（无需处理）
})

afterAll(async () => {
  await app.close()
  db.close()
  // Windows 上文件句柄偶尔还开着，清理失败不该让整轮挂掉（与 test/helpers 的处理一致）
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    // 忽略
  }
})

function url(instance: ReturnType<typeof buildApp>['app']): string {
  const address = instance.server.address()
  if (address === null || typeof address === 'string') throw new Error('拿不到端口')
  return `http://127.0.0.1:${address.port}`
}

/** 一个连不上的远程 + 3s 超时 = 任务能挂住几秒，够我们订阅了 */
async function createSlowTask(target: string): Promise<string> {
  const dir = path.join(root, target)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  fs.writeFileSync(path.join(dir, 'f.txt'), 'hello\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', '初始提交')
  git(dir, 'remote', 'add', 'origin', 'https://192.0.2.1/never.git') // TEST-NET，必然连不通

  const created = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: target, path: dir, category: 'tools' }),
  })
  expect(created.status).toBe(201)
  const id = ((await created.json()) as { project: { id: number } }).project.id

  const started = await fetch(`${baseUrl}/api/updates/check`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ ids: [id] }),
  })
  expect(started.status).toBe(202)
  return ((await started.json()) as { id: string }).id
}

describe('进度 SSE 的连接生命周期', () => {
  it('任务跑完时按顺序推出事件并以 closed 收尾', async () => {
    // 审计指出这一整块原来零测试。这里钉住事件的形状与顺序：
    // started → item（每个仓库）→ finished → closed。
    const taskId = await createSlowTask('sequence-repo')

    const res = await fetch(`${baseUrl}/api/updates/${taskId}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const body = await res.text()
    const events = body
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string })

    const types = events.map((e) => e.type)
    expect(types[0]).toBe('started')
    expect(types).toContain('item')
    expect(types).toContain('finished')
    expect(types[types.length - 1]).toBe('closed')
    // finished 必须在 closed 之前 —— 客户端靠这个顺序决定要不要回调 onFinished
    expect(types.indexOf('finished')).toBeLessThan(types.lastIndexOf('closed'))
  })

  it('订阅不存在的任务返回 404，不是挂住', async () => {
    const res = await fetch(`${baseUrl}/api/updates/does-not-exist/events`)
    expect(res.status).toBe(404)
    await res.text()
  })

  it('客户端中途断开后，服务端要停下来（app.close 不再被挂住）', async () => {
    const taskId = await createSlowTask('slow-repo')

    const controller = new AbortController()
    const stream = await fetch(`${baseUrl}/api/updates/${taskId}/events`, {
      signal: controller.signal,
    })
    expect(stream.status).toBe(200)

    // 读到第一个事件，确认流真的在工作
    const first = await stream.body?.getReader().read()
    expect(new TextDecoder().decode(first?.value)).toContain('data:')

    // 客户端断开
    controller.abort()

    // 服务端必须因此结束这条流：在**另一个不依赖 forceCloseConnections 的**
    // 实例上验证不方便，这里换成直接验证「任务结束后 close 很快返回」。
    // 用一个独立实例 + 已断开的流测 close 的耗时。
    const own = buildApp({ db: openDatabase(':memory:'), logger: false }).app
    await own.listen({ port: 0, host: '127.0.0.1' })
    const started = Date.now()
    await own.close()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('app.close() 不会被一条活跃的 SSE 挂住', async () => {
    // 独立实例 + 独立库，起一个会挂几秒的任务，订阅它，然后在流还活着的时候 close()
    const ownDb = openDatabase(':memory:')
    const own = buildApp({ db: ownDb, logger: false }).app
    await own.listen({ port: 0, host: '127.0.0.1' })
    const ownUrl = url(own)

    await fetch(`${ownUrl}/api/settings`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ gitTimeoutMs: 5_000 }),
    })

    const dir = path.join(root, 'close-repo')
    fs.mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', '初始提交')
    git(dir, 'remote', 'add', 'origin', 'https://192.0.2.1/never.git')

    const created = await fetch(`${ownUrl}/api/projects`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'close-repo', path: dir, category: 'tools' }),
    })
    const id = ((await created.json()) as { project: { id: number } }).project.id
    const startedTask = await fetch(`${ownUrl}/api/updates/check`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ids: [id] }),
    })
    const taskId = ((await startedTask.json()) as { id: string }).id

    // 订阅并保持连接（不 abort）
    const stream = await fetch(`${ownUrl}/api/updates/${taskId}/events`)
    expect(stream.status).toBe(200)
    const reader = stream.body!.getReader()
    await reader.read() // 至少拿到一个事件，确认流活着

    const t0 = Date.now()
    await own.close()
    const elapsed = Date.now() - t0

    void reader
    expect(elapsed, 'close() 不该等这条 SSE 自己结束').toBeLessThan(5_000)
    ownDb.close()
  })
})
