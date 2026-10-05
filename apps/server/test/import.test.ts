import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import * as gitLib from '../src/lib/git.ts'
import * as projectRepo from '../src/repos/projects.ts'

/**
 * `/api/projects/import` 与「数据库约束 → HTTP 状态」的两条真实问题：
 *
 * 1. 导入是边校验边逐个 insert、**没有事务**：中途任何一条失败，前面的行已经
 *    落库，请求却返回 500，响应体也没机会说清哪些成功了。
 * 2. `getRemoteUrl` 的失败没兜底：底层是 execFile，git 起不来时是 reject，
 *    于是「读不到 origin」这种可降级的语义会变成整个请求 500。
 * 3. `pathExists` 与 insert 之间夹着 `await`，并发重复添加会撞 UNIQUE 约束，
 *    落到全局错误处理器变成 500 —— 而 409 才是对的语义。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

const json = { 'content-type': 'application/json' }

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-import-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

let counter = 0
function makeDir(name: string): string {
  counter += 1
  const dir = path.join(root, `${name}-${counter}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

describe('POST /api/projects/import', () => {
  it('批量写入中途失败时不留部分结果（事务）', async () => {
    const first = makeDir('tx-a')
    const second = makeDir('tx-b')
    const third = makeDir('tx-c')

    // 让**第二条**的插入炸掉，看前一条会不会被留在库里
    const real = projectRepo.insertProject
    let calls = 0
    vi.spyOn(projectRepo, 'insertProject').mockImplementation((database, input) => {
      calls += 1
      if (calls === 2) throw new Error('模拟插入失败')
      return real(database, input)
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: json,
      payload: { paths: [first, second, third] },
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    // 事务回滚：一条都不该留下
    const rows = db.prepare('SELECT path FROM projects').all() as { path: string }[]
    expect(rows, '第一条不该被留在库里').toHaveLength(0)
  })

  it('git 读不到 origin 时降级为空，而不是整个请求失败', async () => {
    const dir = makeDir('plain-dir')
    // 该目录存在、但里面没有远程可读：不该让整批导入失败
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: json,
      payload: { paths: [dir] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().created).toHaveLength(1)
  })

  it('读远程地址抛错时也降级为空（git 起不来的场景）', async () => {
    const good = makeDir('spawn-fail')
    vi.spyOn(gitLib, 'getRemoteUrl').mockRejectedValue(new Error('spawn git EPERM'))

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: json,
      payload: { paths: [good] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().created).toHaveLength(1)
    const row = db.prepare('SELECT remote_url FROM projects LIMIT 1').get() as {
      remote_url: string | null
    }
    expect(row.remote_url).toBeNull()
  })

  /*
    批内查重。原来只查「库里有没有」：同一批里两条指向同一目录的路径
    （大小写变体 / 8.3 短名 / 目录链接）都会通过检查，最后撞上库层那条
    `lower(path)` 唯一索引 → 整批回滚 → 409「这条记录已经存在了」，
    而用户可能一个都还没加进去：想加的一个没加上，还收到一句看不懂的话。
  */
  it('同一批里两条同目录不同大小写的路径：跳过重复的那条，其余照常进', async () => {
    const dir = makeDir('CaseRepo')
    const variant = dir.replace(/CaseRepo$/, 'caserepo')
    const before = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: json,
      payload: { paths: [dir, variant] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      created: { path: string }[]
      skipped: { path: string; reason: string }[]
    }
    expect(body.created).toHaveLength(1)
    expect(body.skipped).toHaveLength(1)
    expect(body.skipped[0]?.reason).toContain('重复')
    const after = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n
    expect(after).toBe(before + 1)
  })
})

describe('数据库约束错误的 HTTP 映射', () => {
  it('撞 UNIQUE 约束（并发重复添加的后果）返回 409，不是 500', async () => {
    const dir = makeDir('dup')
    // 先正常建一条
    const first = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: '先到的', path: dir },
    })
    expect(first.statusCode).toBe(201)

    // 再把应用层的重复检查骗过去（模拟「检查时还不存在」的竞态窗口），
    // 让 insert 真的撞上 UNIQUE 约束
    vi.spyOn(projectRepo, 'pathExists').mockReturnValue(false)

    const second = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: '后到的', path: dir },
    })

    expect(second.statusCode).toBe(409)
    expect(second.json().code).toBe('conflict')
  })
})
