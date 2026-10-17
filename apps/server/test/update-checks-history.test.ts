import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { KEEP_CHECKS_PER_PROJECT, pruneUpdateChecks } from '../src/repos/updates.ts'
import { stateVerdict, upstreamBaseline, writeRepoState } from '../src/repos/repo-state.ts'
import type { UpdateReport } from '../src/lib/git.ts'

/**
 * 「上一次留下的那个事实」怎么读，三处必须一致。
 *
 * 有三处会读它：
 * - 清单页的「推荐」列（`latestChecksByProject`，只认**远程结论**那几种状态）
 * - `POST /api/updates/apply` 的服务端闸（拦「别拉」）
 * - 下次同步 / 更新时的基线（判「作者改写了历史」）
 *
 * 它们现在都读 **`repo_state` 的那一行**（一个仓库一行）。这一版之前读的是
 * `update_checks` 的「最新一行」，而那一行**常常故意什么都不带**：断网时自动 fetch
 * 写的是 `error`、没有 verdict；一次 pull 之后写的那行既没有 verdict 也没有上游 SHA。
 * 于是出现过两个真问题：界面还写着「别拉」，服务端那道闸却已经松开；基线每次
 * pull 之后丢一次。
 *
 * 现在这两件事由表结构本身保证：不合格的尝试**根本不会碰**结论列
 * （见 `writeRepoState`），所以「失败把闸冲开」这条路不存在。
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

/** 一个「合格」的检查报告（只有它会覆盖结论） */
function qualified(over: Partial<UpdateReport> = {}): UpdateReport {
  return {
    status: 'behind',
    ahead: 0,
    behind: 2,
    incoming: [],
    outgoing: [],
    tags: [],
    recommendation: { verdict: 'safe', ahead: 0, behind: 2, canPull: true, reason: '可以直接快进。' },
    upstreamSha: 'a'.repeat(40),
    error: null,
    ...over,
  }
}

/** 一次失败的尝试（不合格，只应记 attempt/error） */
function failed(): UpdateReport {
  return {
    status: 'error',
    ahead: null,
    behind: null,
    incoming: [],
    outgoing: [],
    tags: [],
    recommendation: null,
    upstreamSha: null,
    error: { kind: 'network', message: '连不上远程' },
  }
}

describe('判决与基线的读取口径（repo_state）', () => {
  it('后面来了一次失败的同步，闸不能凭空松开', async () => {
    const id = await makeProject('rewritten-then-error')
    writeRepoState(
      db,
      id,
      qualified({
        recommendation: {
          verdict: 'rewritten',
          ahead: 0,
          behind: 2,
          canPull: false,
          reason: '上游历史被改写过。',
        },
      }),
    )
    writeRepoState(db, id, failed())

    // 服务端那道闸读到的仍然是「别拉」
    expect(stateVerdict(db, id)).toMatchObject({ verdict: 'rewritten', canPull: false })
    // 清单页读到的也是同一行（两处口径一致）
    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.latestCheck.recommendation.verdict).toBe('rewritten')
  })

  it('失败的同步不动基线：调用方拿到的仍是上次合格那次的 SHA', async () => {
    const id = await makeProject('baseline-after-error')
    const sha = 'b'.repeat(40)
    writeRepoState(db, id, qualified({ upstreamSha: sha }))
    writeRepoState(db, id, failed())

    // 基线是「我们上次真的问过远程时看到的值」；断网那几次没有提供新事实
    expect(upstreamBaseline(db, id)).toBe(sha)
  })

  it('从来没有成功过时返回 null，不瞎判', async () => {
    const id = await makeProject('no-history')
    writeRepoState(db, id, failed())
    expect(stateVerdict(db, id)).toBeNull()
    expect(upstreamBaseline(db, id)).toBeNull()
  })
})

describe('流水（update_checks）的清理', () => {
  /*
    `update_checks` 已经退出读路径（当前状态在 `repo_state`），它只是追加的流水。
    上限留着是为了别让它无限长；这条用例钉住「裁掉最老的、留下最新的」。
  */
  it('每个项目只保留最近的 N 条', async () => {
    const id = await makeProject('prune')
    const total = KEEP_CHECKS_PER_PROJECT + 25
    for (let i = 0; i < total; i += 1) {
      db.prepare(
        `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
         VALUES (?, ?, 'up_to_date', NULL, NULL, NULL)`,
      ).run(id, new Date().toISOString())
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
  })
})
