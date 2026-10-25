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

  /*
    换目录 = 换了一本账。

    `repo_state` 是按项目存的一行，里面是**旧目录那个仓库**的检查时间 / 判决 /
    基线 SHA / 待拉的提交。项目被重新指到另一个目录之后，那一行还留着的话，界面
    会拿旧仓库的结论去说新目录（「这个目录 25 分钟前联网查过」，清单继续显示旧仓库
    的 ↓22）。所以真要守住的是两件事：**真换了就清掉**、**没换（只改名）就留着**。
  */
  describe('改 path 之后，旧的检查账不能跟着走', () => {
    /** 造一行「上次联网查过：落后 22、可以快进」的账 */
    function seedCheckRow(projectId: number) {
      const at = new Date().toISOString()
      db.prepare(
        `INSERT INTO repo_state
           (project_id, checked_at, status, ahead, behind, verdict, can_pull,
            upstream_sha, incoming, attempt_at, attempt_status)
         VALUES (?, ?, 'behind', 0, 22, 'safe', 1, 'deadbeef', '[]', ?, 'behind')`,
      ).run(projectId, at, at)
    }
    const stateRow = (projectId: number) =>
      db.prepare('SELECT COUNT(*) AS n FROM repo_state WHERE project_id = ?').get(projectId) as {
        n: number
      }

    it('真换了目录：repo_state 被清掉，清单回到「没查过」', async () => {
      const created = await makeProject('repoint-from')
      const id = created.json().project.id
      seedCheckRow(id)
      expect(stateRow(id).n, '先确认账真的造出来了').toBe(1)

      const target = path.join(repoDir, 'repoint-to')
      fs.mkdirSync(target, { recursive: true })

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${id}`,
        headers: json,
        payload: { path: target },
      })
      expect(res.statusCode).toBe(200)
      expect(stateRow(id).n).toBe(0)

      // 界面上读的是 list 的 latestCheck：它必须跟着变成 null，而不是旧目录那次
      const list = await app.inject({ method: 'GET', url: '/api/projects' })
      const row = list.json().projects.find((p: { id: number }) => p.id === id)
      expect(row.latestCheck).toBeNull()
    })

    it('路径没变（只改名字，path 原样提交）：账必须留着', async () => {
      // 编辑资料每次都把 path 一起提交，无条件清就等于「改个名字把检查结论弄丢」
      const created = await makeProject('rename-only')
      const id = created.json().project.id
      const samePath = created.json().project.path as string
      seedCheckRow(id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${id}`,
        headers: json,
        payload: { name: '改个名字', path: samePath },
      })

      expect(res.statusCode).toBe(200)
      expect(stateRow(id).n).toBe(1)
    })
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
  /*
    往 `repo_state` 写一行（判定与新鲜度都读它）。

    这里**直接写 SQL** 而不是走 `writeRepoState`：个别用例要造「列里是坏 JSON」
    这种形状（读的人必须扛住），生产的写入器永远不会写出那种东西。
  */
  /*
    合格的（behind / up_to_date…）覆盖结论；不合格的（error / not_a_repo…）
    **只记尝试**——与 `writeRepoState` 同一条语义。
  */
  const QUALIFIED = new Set(['up_to_date', 'behind', 'ahead', 'diverged'])
  const insertCheck = (projectId: number, status: string, checkedAt: string) =>
    QUALIFIED.has(status)
      ? db
          .prepare(
            `INSERT INTO repo_state (project_id, checked_at, status, ahead, behind, verdict,
                                     can_pull, upstream_sha, incoming, attempt_at, attempt_status, error)
             VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, '[]', ?, ?, NULL)
             ON CONFLICT(project_id) DO UPDATE SET
               checked_at = excluded.checked_at, status = excluded.status,
               attempt_at = excluded.attempt_at, attempt_status = excluded.attempt_status`,
          )
          .run(projectId, checkedAt, status, checkedAt, status)
      : db
          .prepare(
            `INSERT INTO repo_state (project_id, checked_at, status, ahead, behind, verdict,
                                     can_pull, upstream_sha, incoming, attempt_at, attempt_status, error)
             VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, '[]', ?, ?, NULL)
             ON CONFLICT(project_id) DO UPDATE SET
               attempt_at = excluded.attempt_at, attempt_status = excluded.attempt_status`,
          )
          .run(projectId, checkedAt, status, checkedAt, status)

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

/**
 * 「最近一次尝试失败了」这件事必须报出来，而**它不能污染 `latestCheck`**。
 *
 * 上面那组钉的是后一半（失败记录不许刷新新鲜度）。这里钉的是前一半：
 * 用户遇到过的真实困惑是——一边写着「上次检查 42 分钟前 / 落后远程 ↓631」，
 * 一边最近三次检查全都失败（fetch 到 github 443 被重置），界面上一个字都不说。
 * 失败原因早就落在 `update_checks.detail.error` 里了，只是没有任何地方读它。
 *
 * 所以两条路（列表与详情）都要带上 `lastAttempt`，而 `latestCheck` 仍然指向
 * **上一次成功**那条。这是个真不变量：只钉一半的话，「拿失败那次去刷新
 * latestCheck」这种实现能过第一组，却会把界面变成「刚确认过的旧结论」。
 */
describe('lastAttempt：最近一次尝试（不管成败）', () => {
  /**
   * 写一行「当前状态」。
   *
   * 合格的（比如 `behind`）覆盖全部结论；不合格的（`error`）**只动尝试与原因**
   * ——与 `writeRepoState` 同一条语义，这正是下面几条用例要钉的东西。
   */
  const insertCheck = (projectId: number, status: string, checkedAt: string, detail: unknown) => {
    const d = (detail ?? {}) as {
      verdict?: string
      canPull?: boolean
      upstreamSha?: string | null
      error?: unknown
    }
    const qualified = !d.error && (d.verdict !== undefined || status !== 'error')
    db.prepare(
      qualified
        ? `INSERT INTO repo_state (project_id, checked_at, status, ahead, behind, verdict,
                                   can_pull, upstream_sha, incoming, attempt_at, attempt_status, error)
           VALUES (@id, @at, @status, NULL, NULL, @verdict, @canPull, @sha, '[]', @at, @status, NULL)
           ON CONFLICT(project_id) DO UPDATE SET
             checked_at = excluded.checked_at, status = excluded.status,
             verdict = excluded.verdict, can_pull = excluded.can_pull,
             upstream_sha = excluded.upstream_sha, attempt_at = excluded.attempt_at,
             attempt_status = excluded.attempt_status, error = excluded.error`
        : `INSERT INTO repo_state (project_id, checked_at, status, ahead, behind, verdict,
                                   can_pull, upstream_sha, incoming, attempt_at, attempt_status, error)
           VALUES (@id, @at, @status, NULL, NULL, NULL, 0, NULL, '[]', @at, @status, @error)
           ON CONFLICT(project_id) DO UPDATE SET
             attempt_at = excluded.attempt_at, attempt_status = excluded.attempt_status,
             error = excluded.error`,
    ).run({
      id: projectId,
      at: checkedAt,
      status,
      verdict: d.verdict ?? null,
      canPull: d.canPull === true ? 1 : 0,
      sha: d.upstreamSha ?? null,
      error: d.error === undefined ? null : JSON.stringify(d.error),
    })
  }

  const NETWORK_ERROR = {
    kind: 'network',
    message: '连不上远程。检查网络、代理或 DNS',
    raw: "fatal: unable to access 'https://github.com/x/y.git/': Recv failure: Connection was reset",
  }

  it('**最近一次失败 → lastAttempt 带原因，latestCheck 仍然指向上一次成功**', async () => {
    const created = await makeProject('attempt-failed')
    const id = created.json().project.id
    const lastSuccessAt = new Date(Date.now() - 42 * 60_000).toISOString()
    // 上一次成功：落后 631
    insertCheck(id, 'behind', lastSuccessAt, { verdict: 'safe', canPull: true })
    // 之后连着三次失败（用户遇到的那种：fetch 到 github 443 被重置）。
    // 最新的那次的时间记下来，等下要拿它当判据——**取的是最新那一行**，
    // 而不是最早的那次失败。
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
    insertCheck(id, 'error', at(3), { error: NETWORK_ERROR })
    insertCheck(id, 'error', at(2), { error: NETWORK_ERROR })
    const lastFailedAt = at(1)
    insertCheck(id, 'error', lastFailedAt, { error: NETWORK_ERROR })

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    const project = detail.json().project

    // 前一半：最近一次尝试是谁、为什么失败
    expect(project.lastAttempt).toMatchObject({
      at: lastFailedAt,
      status: 'error',
      error: { kind: 'network', message: NETWORK_ERROR.message },
    })

    // 后一半：上一次成功的结论照旧，一个字段都没被失败行盖掉
    expect(project.latestCheck.status).toBe('behind')
    expect(project.latestCheck.checkedAt).toBe(lastSuccessAt)
    expect(project.latestCheck.recommendation.verdict).toBe('safe')

    // 列表那条路也带着同一份（列表与详情必须一致，前端只读一处）
    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    const row = list.json().projects.find((p: { id: number }) => p.id === id)
    expect(row.lastAttempt).toMatchObject({
      at: lastFailedAt,
      status: 'error',
      error: { kind: 'network' },
    })
    expect(row.latestCheck.checkedAt).toBe(lastSuccessAt)
  })

  it('从没检查过：lastAttempt 是 null（不是「检查过但什么都没发生」）', async () => {
    const created = await makeProject('never-checked')
    const id = created.json().project.id

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.lastAttempt).toBeNull()
  })

  it('成功之后又成功：lastAttempt 就是那条成功的（error 为 null，界面不加警示）', async () => {
    const created = await makeProject('attempt-ok')
    const id = created.json().project.id
    insertCheck(id, 'up_to_date', new Date().toISOString(), { verdict: 'safe', canPull: false })

    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    const row = list.json().projects.find((p: { id: number }) => p.id === id)
    expect(row.lastAttempt).toMatchObject({ status: 'up_to_date', error: null })
  })

  it('旧记录里的 error 只有半条（没有 message）→ 读成 null，不往界面塞半条原因', async () => {
    const created = await makeProject('legacy-half-error')
    const id = created.json().project.id
    insertCheck(id, 'error', new Date().toISOString(), { error: { kind: 'network' } })

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.lastAttempt).toMatchObject({ status: 'error', error: null })
  })

  it('detail 不是合法 JSON → 照样给出时间与状态，error 读成 null', async () => {
    const created = await makeProject('broken-detail')
    const id = created.json().project.id
    db.prepare(
      `INSERT INTO repo_state (project_id, checked_at, status, ahead, behind, verdict,
                               can_pull, upstream_sha, incoming, attempt_at, attempt_status, error)
       VALUES (?, ?, 'error', NULL, NULL, NULL, 0, NULL, '[]', ?, 'error', ?)`,
    ).run(id, new Date().toISOString(), new Date().toISOString(), '{ 这不是 JSON')

    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.lastAttempt).toMatchObject({ status: 'error', error: null })
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
