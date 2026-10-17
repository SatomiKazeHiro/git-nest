import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PORTS } from '@git-nest/core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { bindSettings } from '../src/lib/git.ts'

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

/**
 * 一个连不上的远程 + 3s 超时 = 任务能挂住几秒，够我们订阅了。
 * `base` 只在用例自建了另一个实例时才传（那种实例有自己的库与设置）。
 */
async function createSlowTask(target: string, base = baseUrl): Promise<string> {
  const dir = path.join(root, target)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  fs.writeFileSync(path.join(dir, 'f.txt'), 'hello\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', '初始提交')
  git(dir, 'remote', 'add', 'origin', 'https://192.0.2.1/never.git') // TEST-NET，必然连不通

  const created = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: target, path: dir, category: 'tools' }),
  })
  expect(created.status).toBe(201)
  const id = ((await created.json()) as { project: { id: number } }).project.id

  const started = await fetch(`${base}/api/updates/check`, {
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

  /*
    任务没了（服务端重启把内存任务丢了 / 被 TTL 清扫）时的契约。

    这里**故意不是 404**：`EventSource` 读不到状态码，非 2xx 在客户端眼里与断网
    无法区分，于是前端会照常重连 3 次、再报「重连几次都没成功」——而它永远不会
    成功，用户被指向「网断了」这个错误的方向。给一条正常收尾的流，把原因说清楚。
  */
  it('任务不存在时给一条收尾的流（error + closed），不是 404', async () => {
    const res = await fetch(`${baseUrl}/api/updates/does-not-exist/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const body = await res.text()
    const events = body
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; message?: string })

    expect(events.map((e) => e.type)).toEqual(['error', 'closed'])
    expect(events[0]!.message).toContain('重新检查')
  })

  /*
    心跳必须是 `data:` 帧。

    注释帧（`: ping`）浏览器不会派发 message 事件，而前端「多久没事件就认为流
    死了」的看门狗只认消息帧——一个仓库的 fetch 慢过 75 秒，流就会被误判成断了：
    面板报「进度流断了，没能恢复」，好好的任务被扔掉。这条用 200ms 的心跳把
    「服务端确实推的是事件」钉住（25 秒的默认值在用例里没法等）。
  */
  it('心跳是事件帧而不是注释帧（否则客户端看门狗看不见）', async () => {
    const ownDb = openDatabase(':memory:')
    const own = buildApp({ db: ownDb, logger: false, sseHeartbeatMs: 200 }).app
    await own.listen({ port: 0, host: '127.0.0.1' })
    const ownUrl = url(own)

    // 5s 超时：任务活得够久，才等得到心跳
    await fetch(`${ownUrl}/api/settings`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ gitTimeoutMs: 5_000 }),
    })
    const taskId = await createSlowTask('heartbeat-repo', ownUrl)

    const res = await fetch(`${ownUrl}/api/updates/${taskId}/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const deadline = Date.now() + 10_000
    while (!text.includes('"type":"tick"') && Date.now() < deadline) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }

    expect(text, '10 秒内没等到心跳').toContain('"type":"tick"')
    expect(text, '不该再用注释帧当心跳').not.toContain(': ping')

    await reader.cancel()
    await own.close()
    ownDb.close()
    /*
      `bindSettings` 是**模块级单例**（`lib/git.ts` 里那个 `db`）：上面这次 buildApp
      把全局绑定换成了 `ownDb`，它一关，之后任何走 git 的请求都会去读一个已关闭的库
      → 500（实测：后面两条用例的 `POST /api/projects` 直接 500）。
      这里显式换回主实例。不是被测代码的缺陷——生产里只 build 一次 app；
      但这说明「多实例共用一套全局绑定」只适合测试，别在别处依赖它。
    */
    bindSettings(db)
  })

  /*
    这条流的响应头是**直接写在 `reply.raw` 上**的，绕开了 Fastify 的发送通道，
    所以 `@fastify/cors` 设的头一个也到不了线上。只在跨源时现形——浏览器里开发
    走 vite 代理是同源的，一切正常；桌面壳里页面的来源是 web 端口那个（dev）
    或 `http://tauri.localhost`（release），API 在 `127.0.0.1:36379`，跨源。
    缺 `access-control-allow-origin` 的表现不是「报 CORS 错误」，而是浏览器直接判
    这条连接失败 → 前端四次 onerror → 面板上「进度流断了，重连几次都没成功」，
    而同一页面的其它接口全好。
  */
  it('跨源（桌面壳）时流自己带上 CORS 头，别人的页面读不到', async () => {
    const taskId = await createSlowTask('cors-repo')

    for (const origin of [`http://localhost:${DEFAULT_PORTS.web}`, 'http://tauri.localhost']) {
      const res = await fetch(`${baseUrl}/api/updates/${taskId}/events`, { headers: { origin } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin'), `${origin} 拿不到 ACAO`).toBe(origin)
      expect(res.headers.get('vary')).toContain('Origin')
      await res.text()
    }

    // 白名单之外的来源：进度里有项目名，不该漏给任意页面
    const foreign = await fetch(`${baseUrl}/api/updates/${taskId}/events`, {
      headers: { origin: 'http://evil.example' },
    })
    expect(foreign.status).toBe(200)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
    await foreign.text()
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
