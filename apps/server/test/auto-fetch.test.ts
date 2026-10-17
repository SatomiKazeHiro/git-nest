import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { nextAlignedDelay, runAutoFetch } from '../src/lib/auto-fetch.ts'
import { clearCommandLog, recentCommands } from '@git-nest/core/git'

/** 与其它 server 测试同一种做法：真的建 git 仓库，不 mock git。 */
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

/** 服务端统一用正斜杠存路径（见 lib/paths.ts），断言时跟着它走。 */
const slashed = (p: string) => p.replace(/\\/g, '/')

/**
 * 自动 fetch 与命令日志的接口。
 *
 * 「自动 fetch」是用户明确要的（「你可以自动 fetch，但你要记录所有执行过的命令下来」）。
 * 两条硬边界在这里钉住：
 *
 * 1. **只动远程跟踪引用，绝不碰工作区**——「绝不自动更新」那条不变量仍然成立。
 *    所以这一轮跑完，`git status` 必须还是干净的、HEAD 必须没动。
 * 2. **每一条命令都留痕**，label 为 `auto-fetch`。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string
let origin: string
let clone: string
let projectId: number

const json = { 'content-type': 'application/json' }

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-autofetch-')))
  origin = path.join(root, 'origin')
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-b', 'main')
  fs.writeFileSync(path.join(origin, 'README.md'), '# origin\n')
  git(origin, 'add', '-A')
  git(origin, 'commit', '-m', '初始提交')

  clone = path.join(root, 'clone')
  git(root, 'clone', origin, 'clone')

  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

/** 因为建项目要走 app.inject（异步），所以单独一个 beforeAll。 */
beforeAll(async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name: 'auto', path: clone },
  })
  projectId = res.json().project.id as number
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('自动 fetch', () => {
  it(
    '有更新时跑一轮：拿到结论、落库、并且**没有动工作区**',
    async () => {
      // 往 origin 上加一个提交（只推 refs，clone 不 fetch 就不知道）
      fs.writeFileSync(path.join(origin, 'new.txt'), 'new\n')
      git(origin, 'add', '-A')
      git(origin, 'commit', '-m', '远程新提交')

      const headBefore = git(clone, 'rev-parse', 'HEAD').trim()
      const statusBefore = git(clone, 'status', '--porcelain')

      clearCommandLog()
      const summary = await runAutoFetch(db)

      expect(summary.checked).toBeGreaterThanOrEqual(1)
      expect(summary.failed).toBe(0)

      // ① 工作区没动：HEAD 没变、status 依然干净
      expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(headBefore)
      expect(git(clone, 'status', '--porcelain')).toBe(statusBefore)

      // ② 远程跟踪引用**已经**更新了（否则下一句「落后」不成立）
      const status = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/status` })
      expect(status.json().status).toMatchObject({ behind: 1, status: 'behind' })

      // ③ 结论落库了（清单页读的就是它）
      const list = await app.inject({ method: 'GET', url: `/api/projects?q=auto` })
      expect(list.json().projects[0].latestCheck.recommendation).toMatchObject({
        verdict: 'safe',
        canPull: true,
      })
    },
    // 这一条要真的 fetch + 好几个 git 调用；全量跑时进程争 IO，默认 5s 不够
    30_000,
  )

  it('跑过的命令都记下来了，label 是 auto-fetch', () => {
    const log = recentCommands()
    expect(log.length).toBeGreaterThan(0)
    const fetchCommands = log.filter((e) => e.args[0] === 'fetch')
    expect(fetchCommands.length).toBeGreaterThanOrEqual(1)
    expect(fetchCommands[0]!.label).toBe('auto-fetch')
    expect(fetchCommands[0]!.cwd).toBe(slashed(clone))
    // 日志里能看到完整的实参，便于人肉复现
    expect(fetchCommands[0]!.args).toContain('--prune')
  })

  /**
   * 定时器与「现在跑一轮」按钮很容易撞在一起。实测撞到过：2 个仓库跑出 4 条 fetch。
   * `Scheduler` 保证了「同仓库不并发」，但两轮同时跑仍会让每个仓库被 fetch 两次。
   */
  it('并发调用会合流成同一轮，不会把同一个仓库 fetch 两遍', async () => {
    clearCommandLog()
    const [a, b] = await Promise.all([runAutoFetch(db), runAutoFetch(db)])
    // 两次调用拿到的是同一轮的同一个结果对象
    expect(a).toBe(b)

    const fetches = recentCommands().filter((e) => e.args[0] === 'fetch')
    // 只有 1 个仓库有 origin（本项目），所以最多 1 条 fetch
    expect(fetches.length).toBeLessThanOrEqual(1)
  }, 30_000)
})

describe('GET /api/commands', () => {
  it('返回最近的命令（新的在前）与上一轮自动 fetch 的摘要', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commands?limit=10' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.entries.length).toBeLessThanOrEqual(10)
    expect(body.total).toBeGreaterThan(0)
    expect(body.lastAutoFetch).toMatchObject({ projects: expect.any(Number) })
    // 新的在前
    const times = body.entries.map((e: { at: string }) => e.at)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('limit 有上限，越界回落到默认', async () => {
    const big = await app.inject({ method: 'GET', url: '/api/commands?limit=99999' })
    expect(big.statusCode).toBe(200)
    expect(big.json().entries.length).toBeLessThanOrEqual(1000)
  })

  it('DELETE 能清空', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/commands' })
    expect(del.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: '/api/commands' })
    expect(after.json().total).toBe(0)
  })

  /*
    这一条**天然更慢**，所以要显式给更长的超时（30s），而不是去调全局 `testTimeout`。

    为什么慢：它真的会跑 git 子进程（fetch 一个本地 fixture 仓库），而 Windows 上
    `execFile` 起一次 git.exe 就有约 20ms 的 CreateProcess 地板、整条链路实测 1.3s 上下；
    机器一忙（比如同时在编译 Rust）它就撞上 vitest 默认的 5000ms —— 报的是
    `Test timed out in 5000ms`，看起来像逻辑坏了，其实只是被抢了 CPU。

    为什么不用全局超时兜底：全局放大会**掩盖别处真正的慢**（一个真的死循环也会变得「不超时」）。
    只有这一条知道自己为什么慢，所以只有这一条自己申明。

    **断言与语义一个字没改**——只加了超时。
  */
  it('POST /api/auto-fetch 手动跑一轮（定时器最快也要等 30 秒）', { timeout: 30_000 }, async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auto-fetch' })
    expect(res.statusCode).toBe(200)
    expect(res.json().summary).toMatchObject({ checked: expect.any(Number) })
  })
})

describe('定时节奏（对齐 :00 / :30）', () => {
  const T = 30 * 60_000

  it('离下一档还有多久：恰好站在边界上时给整整一个间隔', () => {
    expect(nextAlignedDelay(0, T)).toBe(T)
    expect(nextAlignedDelay(T, T)).toBe(T)
    expect(nextAlignedDelay(T * 7, T)).toBe(T)
    // 边界前 1ms
    expect(nextAlignedDelay(T - 1, T)).toBe(1)
    // 中间
    expect(nextAlignedDelay(T / 2, T)).toBe(T / 2)
    expect(nextAlignedDelay(T + 600_000, T)).toBe(T - 600_000)
  })

  it('落到**本地**的整点 / 半点上', () => {
    /*
      对齐的前提：本机时区偏移是 30 分钟的整数倍（地球上绝大多数是 15 的倍数）。
      这里不写死时间戳，而是直接验「结果换算成本地时间之后，分钟是 0 或 30」。
    */
    const now = Date.now()
    const next = now + nextAlignedDelay(now)
    const offsetMinutes = new Date(now).getTimezoneOffset() // UTC - 本地，分钟
    const localMinutes = next / 60_000 - offsetMinutes
    expect(localMinutes % 30).toBe(0)
    expect((next / 1000) % 60).toBe(0)
  })
})