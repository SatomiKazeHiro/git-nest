import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

/**
 * 分类：**内置四个 + 用户可新增**。
 *
 * 这个设计最关键的一点是「`projects.category` 一个字节都不用迁移」——内置四个的
 * **key 用的就是库里已经存着的值**（`knowledge-base` / `backups` / `experiments` /
 * `tools`），所以这张新表只是给这些值补上「显示名 + 图标 + 是不是内置」。
 * 第一条用例就是在钉这件事（另一条同样的钉子钉在 core 的
 * `builtin-categories.test.ts` 上：四个 key 必须就是库里存着的那四个字面量）。
 *
 * 两个坑，都是这套用例自己踩出来的：
 *
 * 1. **建项目要走一个真实目录**——路由会先 `dirExists`，编一个 `D:/repos/xxx`
 *    只会拿到 400，而不是它想测的那个错。
 * 2. **没有 body 的请求不能带 `content-type: application/json`**——Fastify 会以
 *    「Body cannot be empty」回 400，于是 DELETE 的断言全都在测一个跟分类无关的东西。
 *    所以下面分成 `get` / `del` / `send` 三个口，**形状即约定**。
 *
 * 每条用例一个内存库：key 是按需生成的（`ai` / `ai-2` / `cat-1`），共享库会让用例
 * 之间互相影响、序号不可预测。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

const json = { 'content-type': 'application/json' }

const get = (url: string) => app.inject({ method: 'GET', url: `/api${url}` })
const del = (url: string) => app.inject({ method: 'DELETE', url: `/api${url}` })
const send = (method: 'POST' | 'PATCH', url: string, payload: object) =>
  app.inject({ method, url: `/api${url}`, headers: json, payload })

/** 每个项目一个真实目录（路由要求目录存在，而且 path 是 UNIQUE 的）。 */
function tempDir(name: string): string {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 建项目时**显式给 remoteUrl**：不给的话服务端会去跑一次 git 读 origin，
 * 而这条用例要测的是分类校验，不是「读 remote」。git 那件事另有测试盯着。
 */
const addProject = (name: string, category: string) =>
  send('POST', '/projects', {
    name,
    path: tempDir(name),
    remoteUrl: 'https://example.com/x.git',
    category,
    record: '',
  })

beforeEach(() => {
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})
beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-categories-')))
})
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('分类 · 内置四个', () => {
  it('库里已经存着的四个值就是内置项，按 sort_order 排', async () => {
    const res = await get('/categories')
    expect(res.statusCode).toBe(200)

    const categories = res.json().categories as { key: string; label: string; builtin: boolean }[]
    expect(categories.map((c) => c.key)).toEqual([
      'knowledge-base',
      'backups',
      'experiments',
      'tools',
    ])
    // 「试验」不是「实验」（用户确认过；内置项不可改名，所以这里定死）
    expect(categories.map((c) => c.label)).toEqual(['知识库', '备份', '试验', '工具'])
    expect(categories.every((c) => c.builtin)).toBe(true)
  })

  it('内置项不能改名、不能删', async () => {
    expect((await send('PATCH', '/categories/tools', { label: '工具2' })).statusCode).toBe(409)
    expect((await del('/categories/tools')).statusCode).toBe(409)
  })
})

describe('分类 · 新增', () => {
  it('key 服务端生成：从名称取 slug，撞了就加序号', async () => {
    const first = await send('POST', '/categories', { label: 'AI 项目' })
    expect(first.statusCode).toBe(201)
    expect(first.json().category.key).toBe('ai')

    const second = await send('POST', '/categories', { label: 'AI 项目' })
    expect(second.json().category.key).toBe('ai-2')
  })

  it('名称全是中文、取不出 slug 时兜底成 cat-1（照样唯一）', async () => {
    const res = await send('POST', '/categories', { label: '知识库' })
    expect(res.statusCode).toBe(201)
    expect(res.json().category.key).toBe('cat-1')
  })

  it('新增的不是内置项，引用数为 0', async () => {
    const created = (await send('POST', '/categories', { label: 'AI 项目' })).json().category
    expect(created.builtin).toBe(false)
    expect(created.projectCount).toBe(0)
  })

  it('名称不能为空（422，逐字段说明）', async () => {
    expect((await send('POST', '/categories', { label: '   ' })).statusCode).toBe(422)
  })
})

describe('分类 · 改名与图标', () => {
  it('用户分类可以改名；key 不变（项目上存的是 key）', async () => {
    await send('POST', '/categories', { label: 'AI 项目' })

    const res = await send('PATCH', '/categories/ai', { label: 'AI 项目（改）' })
    expect(res.statusCode).toBe(200)
    expect(res.json().category).toMatchObject({ key: 'ai', label: 'AI 项目（改）' })
  })

  it('不存在的 key → 404', async () => {
    expect((await send('PATCH', '/categories/nope', { label: 'x' })).statusCode).toBe(404)
  })
})

describe('分类 · 删除会把项目退回未分类', () => {
  it('删掉用户分类：项目回到未分类，并告诉调用方影响了几个', async () => {
    await send('POST', '/categories', { label: 'AI 项目' })
    expect((await addProject('one', 'ai')).statusCode).toBe(201)
    expect((await addProject('two', 'ai')).statusCode).toBe(201)

    const res = await del('/categories/ai')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ removed: 1, moved: 2 })

    const list = await get('/projects')
    expect(list.json().projects.every((p: { category: string }) => p.category === '')).toBe(true)
  })

  it('不存在的 key → 404', async () => {
    expect((await del('/categories/nope')).statusCode).toBe(404)
  })
})

describe('分类 · 列表带上引用数', () => {
  it('数的是引用它的项目', async () => {
    await send('POST', '/categories', { label: 'AI 项目' })
    await addProject('one', 'ai')
    await addProject('two', 'tools')

    const categories = (await get('/categories')).json().categories as {
      key: string
      projectCount: number
    }[]
    expect(categories.find((c) => c.key === 'ai')?.projectCount).toBe(1)
    expect(categories.find((c) => c.key === 'tools')?.projectCount).toBe(1)
    expect(categories.find((c) => c.key === 'backups')?.projectCount).toBe(0)
  })
})

describe('项目上的分类：必须在表里，或者空串', () => {
  it('空串（未分类）继续合法——扫描导入的一律留空，这是最常见的取值', async () => {
    const res = await addProject('untagged', '')
    expect(res.statusCode).toBe(201)
    expect(res.json().project.category).toBe('')
  })

  it('内置的 key 合法', async () => {
    expect((await addProject('mine-tools', 'tools')).statusCode).toBe(201)
  })

  it('用户新增的 key 合法', async () => {
    await send('POST', '/categories', { label: 'AI 项目' })
    expect((await addProject('ai-one', 'ai')).statusCode).toBe(201)
  })

  it('表里没有的 key 被拒（400，不是 422：形状没错，是它不存在）', async () => {
    expect((await addProject('bad', '不存在的分类')).statusCode).toBe(400)
  })

  it('改项目时同样校验', async () => {
    const id = (await addProject('one', '')).json().project.id as number

    expect((await send('PATCH', `/projects/${id}`, { category: '不存在' })).statusCode).toBe(400)

    const ok = await send('PATCH', `/projects/${id}`, { category: 'experiments' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().project.category).toBe('experiments')
  })
})
