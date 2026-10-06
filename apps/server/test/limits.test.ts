import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_BATCH_IDS, MAX_SCAN_RESULTS, MAX_STATUS_IDS } from '@git-nest/core'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { getRemoteUrl } from '../src/lib/git.ts'

/**
 * 各处批量上限，以及「上限只有一份」这件事。
 *
 * 踩过的坑：上限原来散在五处（status 200、check 200、apply 200、import 200、
 * 扫描 500），**前端一个都不知道**。后果分两种：
 * - 项目超过 200 个时，列表页把全部 id 一发出去 → 400 → 前端把错误丢了 →
 *   每一行永远显示「读状态…」（静默残废，用户看不出为什么）；
 * - 点「联网检查更新」/「添加选中的 N 个」→ 422「参数有误」（说了等于没说）。
 *
 * 现在数字在 core 的 `limits.ts`，服务端按它校验、前端按它分块或提前拦下。
 * 这个文件钉住服务端那一侧的数字，以及「扫描列出的最大数量 ≤ 导入能接受的最大数量」
 * 这条构造性关系 —— 否则用户会在「全选 → 添加」那一步撞墙。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

const json = { 'content-type': 'application/json' }

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-limits-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i)

describe('GET /api/status 的条数上限（前端按同一个数字分块）', () => {
  it(`正好 ${MAX_STATUS_IDS} 个：放行`, async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/status?ids=${ids(MAX_STATUS_IDS).join(',')}`,
    })
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200)
    expect(res.json().statuses).toHaveLength(MAX_STATUS_IDS)
  })

  it(`超过一个就 ${'4'}00，且说清上限是多少`, async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/status?ids=${ids(MAX_STATUS_IDS + 1).join(',')}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain(String(MAX_STATUS_IDS))
  })
})

describe('批量检查 / 更新的条数上限', () => {
  it(`check：${MAX_BATCH_IDS} 个之内放行（空清单下就是「没有可检查的项目」）`, async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      headers: json,
      payload: { ids: ids(Math.min(MAX_BATCH_IDS, 3)) },
    })
    // 清单是空的 → 400「没有可检查的项目」；这里要的是**不是**上限拦的
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('没有可检查的项目')
  })

  it(`check：超过 ${MAX_BATCH_IDS} 个 → 422，而不是静默截断`, async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      headers: json,
      payload: { ids: ids(MAX_BATCH_IDS + 1) },
    })
    expect(res.statusCode).toBe(422)
  })

  it(`apply：超过 ${MAX_BATCH_IDS} 个 → 422`, async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/updates/apply',
      headers: json,
      payload: { ids: ids(MAX_BATCH_IDS + 1) },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('导入的条数上限（与扫描列出的上限是同一个常量）', () => {
  /*
    两侧读的是 core 的同一个 `MAX_SCAN_RESULTS`，所以「扫描列出的候选不会超过导入
    能接受的数量」是构造上成立的，不需要再写一条同义反复的断言。这里只钉住**服务端
    这一侧的实际边界行为**：正好 500 条要放行（否则「全选」还是会撞墙），501 条才拒。
  */
  it(`一次给 ${MAX_SCAN_RESULTS} 条路径也被接受（不存在的会被跳过，不是 422）`, async () => {
    const existing = path.join(root, 'only-one')
    fs.mkdirSync(existing, { recursive: true })
    const paths = [existing, ...ids(MAX_SCAN_RESULTS - 1).map((n) => path.join(root, `nope-${n}`))]

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: json,
      payload: { paths },
    })

    expect(res.statusCode, res.body.slice(0, 200)).toBe(200)
    const body = res.json() as { created: unknown[]; skipped: { reason: string }[] }
    expect(body.created).toHaveLength(1)
    expect(body.skipped).toHaveLength(MAX_SCAN_RESULTS - 1)
  })

  it(`超过 ${MAX_SCAN_RESULTS} 条 → 422`, async () => {
    const paths = ids(MAX_SCAN_RESULTS + 1).map((n) => path.join(root, `nope-${n}`))
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/import',
      headers: json,
      payload: { paths },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('读 origin 地址不会自锁（排队只做一次）', () => {
  it('同一个仓库并发读两次都能返回', async () => {
    // 要用**真仓库**：`git remote get-url` 在只有 .git/config 的假目录里会直接失败
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-remote-')))
    const url = 'https://example.invalid/self-lock.git'
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', url], { cwd: dir })

    /*
      原来是「core 的函数自己排队 + server 再包一层排队」，靠**故意不传 scheduler**
      才没自锁：谁顺手把那个参数补上，这两次调用就永远不返回（同 key 的 schedule
      里再 schedule）。现在 server 用的是 core 的纯实现，排队只在这一层做。
      用 race 兜底，失败时给一句人话而不是等到 60 秒超时。
    */
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('自锁了：同 key 的 schedule 里又排了一次队')), 5_000),
    )

    const urls = await Promise.race([Promise.all([getRemoteUrl(dir), getRemoteUrl(dir)]), timeout])

    expect(urls).toEqual([url, url])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
