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

  it('不把数据库绝对路径回给客户端', async () => {
    // 本机绝对路径是这个工具的隐私约定（只进本地 SQLite，不进任何会被分享的东西），
    // 而 /api/health 是个可以被随手打开的接口。
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    const body = res.json() as Record<string, unknown>
    // `db` 这个键原来装的就是数据库文件路径，现在不再回它
    expect(body.db).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('git-nest.db')
    expect(JSON.stringify(body)).not.toMatch(/[A-Za-z]:[\\/]/)
  })

  it('真的探一下数据库（不是恒真）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.json()).toMatchObject({ ok: true, database: 'ok' })
  })
})

describe('POST /api/projects', () => {
  it('创建后返回完整项目记录', async () => {
    const res = await makeProject('alpha', { category: 'tools', record: '在 B 站看到的' })
    expect(res.statusCode).toBe(201)
    const { project } = res.json()
    expect(project).toMatchObject({ name: 'alpha', category: 'tools', record: '在 B 站看到的' })
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

  it('只改一个字段不会清空其它字段', async () => {
    // 这条守的是一个真实踩过的坑：zod 的 transform 挂在最外层时，
    // 未提交的键会被物化成 null，于是「改个名字」会把远程地址/记录一起清掉。
    const created = await makeProject('patch-me', {
      record: '原记录',
      remoteUrl: 'https://example.invalid/repo.git',
    })
    const id = created.json().project.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: json,
      payload: { name: '改名后' },
    })

    expect(res.statusCode).toBe(200)
    const { project } = res.json()
    expect(project.name).toBe('改名后')
    expect(project.record).toBe('原记录')
    expect(project.remoteUrl).toBe('https://example.invalid/repo.git')

    // 落库的也得是原值，不能只是响应好看
    const row = db
      .prepare('SELECT record, remote_url FROM projects WHERE id = ?')
      .get(id) as { record: string; remote_url: string | null }
    expect(row).toEqual({
      record: '原记录',
      remote_url: 'https://example.invalid/repo.git',
    })
  })

  it('记录清空 = 提交空串（这一列是 NOT NULL，不用 null 表示空）', async () => {
    const created = await makeProject('clear-me', { record: '要被清掉的记录' })
    const id = created.json().project.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: json,
      payload: { record: '' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().project.record).toBe('')
  })

  it('空 body 返回 422 而不是静默通过', async () => {
    const created = await makeProject('empty-patch')
    const id = created.json().project.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(422)
  })

  it('同一路径不同大小写也算重复（Windows 上目录不区分大小写）', async () => {
    // SQLite 的 `=` 对 TEXT 默认区分大小写，而 NTFS 不区分。
    // 只靠应用层比较，同一个目录能进清单两条：状态查两次、DELETE 只删一条。
    const created = await makeProject('case-canonical')
    expect(created.statusCode).toBe(201)
    const original = created.json().project.path as string

    const again = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: 'case-upper', path: original.toUpperCase() },
    })

    expect(again.statusCode).toBe(409)
  })

  it('改 path 时也要做同样的大小写比较', async () => {
    const first = await makeProject('case-a')
    const second = await makeProject('case-b')
    const target = first.json().project.path as string

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${second.json().project.id}`,
      headers: json,
      payload: { path: target.toUpperCase() },
    })

    expect(res.statusCode).toBe(409)
  })

  it('删除项目不会留下标签关联与检查历史', async () => {
    // 标题原来写「备注与标签关联」，但只断言了 notes（审计指出：假绿）。
    // 备注后来整个撤掉了，这里改成把两种会级联的子行真的造出来 ——
    // 空表上的 COUNT(*) = 0 说明不了任何事。
    const created = await makeProject('temporary')
    const id = created.json().project.id

    const tagged = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/tags`,
      headers: json,
      payload: { tagNames: ['要删的标签'] },
    })
    expect(tagged.statusCode).toBe(200)
    db.prepare(
      `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(id, new Date().toISOString(), 'behind', 0, 1)

    // 先确认两张表真的有行（否则下面的 0 是空的 0）
    const countOf = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(id) as { n: number })
        .n
    expect(countOf('project_tags')).toBe(1)
    expect(countOf('update_checks')).toBe(1)

    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${id}` })
    expect(res.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/projects/${id}` })).statusCode).toBe(404)

    for (const table of ['project_tags', 'update_checks']) {
      expect(countOf(table), `${table} 不该留下孤儿行`).toBe(0)
    }
    // 标签本身留着（可能还有别的项目在用）
    const tagLeft = db.prepare('SELECT COUNT(*) AS n FROM tags WHERE name = ?').get('要删的标签') as {
      n: number
    }
    expect(tagLeft.n).toBe(1)
    // 磁盘目录仍在：删除只动 DB
    expect(fs.existsSync(path.join(repoDir, 'temporary'))).toBe(true)
  })

  it('不存在的项目返回 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/9999' })
    expect(res.statusCode).toBe(404)
  })
})

describe('latestCheck 只能由成功的远程检查提供', () => {
  /**
   * 新鲜度用的是 `latestCheck.checkedAt`（见 StatusCell 的 freshnessOf）。
   * 如果 fetch 失败的检查也能刷新它，那断网之后点一次「检查更新」，
   * 清单页反而会显示刚确认过的绿色「已是最新」—— 正是这个软件最要消灭的那种
   * 「没有依据的肯定」。
   */
  const insertCheck = (projectId: number, status: string, checkedAt: string) =>
    db
      .prepare(
        `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
         VALUES (?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(projectId, checkedAt, status)

  it('只有失败记录时 latestCheck 为 null（等于「没查过远程」）', async () => {
    const created = await makeProject('only-failed')
    const id = created.json().project.id
    insertCheck(id, 'error', new Date().toISOString())

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.latestCheck).toBeNull()

    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    const row = list.json().projects.find((p: { id: number }) => p.id === id)
    expect(row.latestCheck).toBeNull()
  })

  it('「不是仓库」这类本地状态也不算问过远程', async () => {
    const created = await makeProject('not-a-repo-check')
    const id = created.json().project.id
    insertCheck(id, 'not_a_repo', new Date().toISOString())

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.latestCheck).toBeNull()
  })

  it('有成功记录时照常给出（失败记录不会盖掉它）', async () => {
    const created = await makeProject('mixed-checks')
    const id = created.json().project.id
    const earlier = new Date(Date.now() - 60_000).toISOString()
    insertCheck(id, 'behind', earlier)
    insertCheck(id, 'error', new Date().toISOString())

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    const latest = detail.json().project.latestCheck
    expect(latest).not.toBeNull()
    expect(latest.status).toBe('behind')
    expect(latest.checkedAt).toBe(earlier)
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

  /*
    同一个字段有两个写入口，校验就必须是同一份。
    `POST /api/tags` 一直有 `.max(40)`，而 `PUT /api/projects/:id/tags` 是「按需创建」
    标签的那条路——原来只限条数不限长度，于是能从这里塞进任意长的标签名
    （实测 200 字入库），反过来还能用一个超长名字绕过创建接口的全部约束。
  */
  it('标签名的长度上限在两个入口上一致（PUT /projects/:id/tags 也要拦）', async () => {
    const created = await makeProject('tag-length')
    const projectId = created.json().project.id
    const tooLong = 'x'.repeat(41)

    const viaCreate = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: json,
      payload: { name: tooLong },
    })
    expect(viaCreate.statusCode).toBe(422)

    const viaProject = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/tags`,
      headers: json,
      payload: { tagNames: [tooLong] },
    })
    expect(viaProject.statusCode).toBe(422)

    const stored = db.prepare('SELECT name FROM tags WHERE name = ?').get(tooLong)
    expect(stored, '超长标签名不该被按需创建出来').toBeUndefined()
  })
})
