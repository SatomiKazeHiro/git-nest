import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { KEEP_CHECKS_PER_PROJECT, lastUpstreamSha, lastVerdict, pruneUpdateChecks } from '../src/repos/updates.ts'

/**
 * 「上一次留下的那个事实」怎么读，两处必须一致。
 *
 * 有三处会读它：
 * - 清单页显示「推荐」列（`latestChecksByProject`，只认**远程结论**那几种状态）
 * - `PUT /api/updates/apply` 的服务端闸（拦「别拉」）
 * - 下次检查 / 更新时的基线（判「作者改写了历史」）
 *
 * 原来后两处都是「最新一行，读不出来就 null」。而**最近一行常常故意什么都不带**：
 * 自动 fetch 每 30 分钟跑一轮，断网时写的那行是 `error`、没有 verdict；
 * 一次 pull 之后写的那行既没有 verdict 也没有上游 SHA（那一刻真正的答案是
 * 「刚拉过了」）。于是：
 * - 界面还写着「别拉」，服务端那道闸却已经松开；
 * - 基线每次 pull 之后丢一次。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-history-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

let counter = 0
async function makeProject(name: string): Promise<number> {
  counter += 1
  const dir = path.join(root, `${name}-${counter}`)
  fs.mkdirSync(dir, { recursive: true })
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json' },
    payload: { name, path: dir, category: 'tools' },
  })
  expect(res.statusCode).toBe(201)
  return res.json().project.id as number
}

function insertCheck(projectId: number, status: string, detail: object | null): void {
  db.prepare(
    `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
     VALUES (?, ?, ?, NULL, NULL, ?)`,
  ).run(projectId, new Date().toISOString(), status, detail ? JSON.stringify(detail) : null)
}

describe('判决与基线的读取口径', () => {
  it('后面插了一行没有 verdict 的失败检查，闸不能凭空松开', async () => {
    const id = await makeProject('rewritten-then-error')
    insertCheck(id, 'behind', {
      incoming: 3,
      outgoing: 0,
      tags: [],
      verdict: 'rewritten',
      canPull: false,
      upstreamSha: 'a'.repeat(40),
    })
    // 自动 fetch 在断网时写的那一行：error，没有 verdict
    insertCheck(id, 'error', { incoming: 0, outgoing: 0, tags: [], error: { kind: 'network' } })

    // 服务端那道闸读到的仍然是「别拉」
    expect(lastVerdict(db, id)).toMatchObject({ verdict: 'rewritten', canPull: false })
    // 清单页读到的也是同一条（两处口径一致）
    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.latestCheck.recommendation.verdict).toBe('rewritten')
  })

  it('pull 之后写的那行没带上游 SHA → 读成 null，让调用方退回本地 ref', async () => {
    const id = await makeProject('baseline-after-pull')
    const sha = 'b'.repeat(40)
    insertCheck(id, 'behind', { incoming: 1, outgoing: 0, tags: [], verdict: 'safe', canPull: true, upstreamSha: sha })
    // runApply 写的那一行：status 是 up_to_date（算远程结论），但没有 verdict / 上游 SHA
    insertCheck(id, 'up_to_date', { incoming: 0, outgoing: 0, tags: [] })

    /*
      **故意不往回翻更早那行**。SHA 属于某一条上游 ref，而 detail 里不记是哪一条：
      A 分支上记的值拿去问 B 分支，答案必然是「不是祖先」，于是报
      「作者改写了历史，别拉」——作者什么都没干。这种假警报比「判不出来」坏得多。
      最新一行没有 SHA 时返回 null，调用方（analyzeUpdates）会退回**本地 ref**，
      那个值天然属于当前这条线（见 repos/updates.ts 的注释）。
    */
    expect(lastUpstreamSha(db, id)).toBeNull()
    // 判决那一侧同一条记录里也没有 verdict —— 这是有意的：那一刻真正的答案是「刚拉过了」
    expect(lastVerdict(db, id)).toBeNull()
  })

  it('从来没有成功记录时返回 null，不瞎判', async () => {
    const id = await makeProject('no-history')
    insertCheck(id, 'error', { incoming: 0, outgoing: 0, tags: [], error: { kind: 'network' } })
    expect(lastVerdict(db, id)).toBeNull()
    expect(lastUpstreamSha(db, id)).toBeNull()
  })
})

describe('检查历史的清理', () => {
  it('每个项目只保留最近的 N 条，最新的那条一定要留着', async () => {
    const id = await makeProject('prune')
    const total = KEEP_CHECKS_PER_PROJECT + 25
    for (let i = 0; i < total; i += 1) {
      insertCheck(id, 'up_to_date', { incoming: 0, outgoing: 0, tags: [], verdict: 'safe', canPull: false })
    }
    const before = db
      .prepare('SELECT COUNT(*) AS n FROM update_checks WHERE project_id = ?')
      .get(id) as { n: number }
    expect(before.n).toBe(total)

    const removed = pruneUpdateChecks(db)
    expect(removed).toBe(25)

    const after = db
      .prepare('SELECT COUNT(*) AS n FROM update_checks WHERE project_id = ?')
      .get(id) as { n: number }
    expect(after.n).toBe(KEEP_CHECKS_PER_PROJECT)
    // 最新那条（也就是闸与基线读的那条）必须在
    expect(lastVerdict(db, id)).not.toBeNull()
  })
})
