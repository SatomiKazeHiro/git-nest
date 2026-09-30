import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

let db: DB
let app: ReturnType<typeof buildApp>['app']
let repoDir: string

const json = { 'content-type': 'application/json' }

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-test-'))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(repoDir, { recursive: true, force: true })
})

function makeProject(name: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(repoDir, name)
  fs.mkdirSync(dir, { recursive: true })
  return app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name, path: dir, ...extra },
  })
}

describe('GET /api/health', () => {
  it('返回 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
  })
})

describe('POST /api/projects', () => {
  it('创建后返回完整项目记录', async () => {
    const res = await makeProject('alpha', { category: 'tools', summary: '示例摘要' })
    expect(res.statusCode).toBe(201)
    const { project } = res.json()
    expect(project).toMatchObject({ name: 'alpha', category: 'tools', summary: '示例摘要' })
    expect(project.path).not.toContain('\\')
    expect(project.tags).toEqual([])
    expect(project.latestCheck).toBeNull()
  })

  it('目录不存在时报 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: 'ghost', path: path.join(repoDir, 'nope-not-here') },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('bad_request')
  })

  it('同一路径重复添加时报 409', async () => {
    const res = await makeProject('dup')
    expect(res.statusCode).toBe(201)
    const again = await makeProject('dup')
    expect(again.statusCode).toBe(409)
  })

  it('缺字段时逐项说明', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: '  ' },
    })
    expect(res.statusCode).toBe(422)
    const body = res.json()
    expect(body.code).toBe('validation_failed')
    expect(body.issues.map((i: { path: string }) => i.path)).toContain('name')
  })
})

describe('GET /api/projects', () => {
  it('按分类、标签、关键字过滤', async () => {
    const withTag = await makeProject('tagged', { category: 'backups' })
    const projectId = withTag.json().project.id
    const tagRes = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/tags`,
      headers: json,
      payload: { tagNames: ['归档', '重要'] },
    })
    expect(tagRes.statusCode).toBe(200)

    const byCategory = await app.inject({ method: 'GET', url: '/api/projects?category=backups' })
    expect(byCategory.json().projects.map((p: { name: string }) => p.name)).toEqual(['tagged'])

    const byTag = await app.inject({ method: 'GET', url: '/api/projects?tag=归档' })
    expect(byTag.json().projects).toHaveLength(1)
    expect(byTag.json().projects[0].tags[0].name).toBe('归档')

    const byQuery = await app.inject({ method: 'GET', url: '/api/projects?q=tagg' })
    expect(byQuery.json().projects).toHaveLength(1)

    const miss = await app.inject({ method: 'GET', url: '/api/projects?q=不存在的名字' })
    expect(miss.json().projects).toHaveLength(0)
  })

  it('按 category 分组排序，无分类的排在最后', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    const categories = res.json().projects.map((p: { category: string }) => p.category)
    const firstEmpty = categories.indexOf('')
    expect(firstEmpty === -1 || categories.slice(firstEmpty).every((c: string) => c === '')).toBe(
      true,
    )
  })
})

describe('PATCH / DELETE /api/projects/:id', () => {
  it('改名与改分类', async () => {
    const created = await makeProject('editable')
    const id = created.json().project.id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: json,
      payload: { name: 'renamed', category: 'experiments' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().project).toMatchObject({ name: 'renamed', category: 'experiments' })
  })

  it('删除项目不会留下备注与标签关联', async () => {
    const created = await makeProject('temporary')
    const id = created.json().project.id
    await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/notes`,
      headers: json,
      payload: { content: '待会儿删掉' },
    })

    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${id}` })
    expect(res.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/projects/${id}` })).statusCode).toBe(404)

    const left = db
      .prepare('SELECT COUNT(*) AS n FROM notes WHERE project_id = ?')
      .get(id) as { n: number }
    expect(left.n).toBe(0)
    // 磁盘目录仍在：删除只动 DB
    expect(fs.existsSync(path.join(repoDir, 'temporary'))).toBe(true)
  })

  it('不存在的项目返回 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/9999' })
    expect(res.statusCode).toBe(404)
  })
})

describe('notes', () => {
  it('增删改', async () => {
    const created = await makeProject('noted')
    const id = created.json().project.id

    const add = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/notes`,
      headers: json,
      payload: { content: '第一条备注' },
    })
    expect(add.statusCode).toBe(201)

    const list = await app.inject({ method: 'GET', url: `/api/projects/${id}/notes` })
    expect(list.json().notes).toHaveLength(1)
    const noteId = list.json().notes[0].id

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/notes/${noteId}`,
      headers: json,
      payload: { content: '改过的备注' },
    })
    expect(edited.statusCode).toBe(200)

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.notes[0].content).toBe('改过的备注')

    expect((await app.inject({ method: 'DELETE', url: `/api/notes/${noteId}` })).statusCode).toBe(
      200,
    )
    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/${id}/notes` })).json().notes,
    ).toHaveLength(0)
  })

  it('空备注被拒绝', async () => {
    const created = await makeProject('blank-note')
    const id = created.json().project.id
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/notes`,
      headers: json,
      payload: { content: '   ' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('tags', () => {
  it('创建标签、统计使用数、删除标签', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: json,
      payload: { name: '值得看', color: '#14506E' },
    })
    expect(created.statusCode).toBe(201)
    const tagId = created.json().tag.id

    const dup = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: json,
      payload: { name: '值得看' },
    })
    expect(dup.statusCode).toBe(409)

    const badColor = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: json,
      payload: { name: '色值不对', color: 'red' },
    })
    expect(badColor.statusCode).toBe(422)

    const list = await app.inject({ method: 'GET', url: '/api/tags' })
    const tag = list.json().tags.find((t: { name: string }) => t.name === '值得看')
    expect(tag).toMatchObject({ color: '#14506E' })

    expect((await app.inject({ method: 'DELETE', url: `/api/tags/${tagId}` })).statusCode).toBe(200)
  })
})
