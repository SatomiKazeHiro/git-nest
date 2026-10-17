import { describe, expect, it } from 'vitest'
import type { UpdateReport } from '../src/lib/git.ts'
import { openDatabase } from '../src/db/index.ts'
import { INCOMING_KEEP, readRepoState, readRepoStates, writeRepoState } from '../src/repos/repo-state.ts'

/**
 * `repo_state` 的写入语义（`docs/软件定位.md` §3：一个仓库一条数据）。
 *
 * 这一层不跑 git：`writeRepoState` 收的是已经算好的报告，所以这些东西可以逐条钉住
 * ——它们正是「同一事实只有一种读法」的全部前提。
 */

function report(over: Partial<UpdateReport> = {}): UpdateReport {
  return {
    status: 'behind',
    ahead: 0,
    behind: 3,
    incoming: Array.from({ length: 9 }, (_, i) => ({
      shortHash: `h${i}`,
      subject: `第 ${i} 条`,
      author: 'a',
      date: '2026-10-17T00:00:00Z',
    })),
    outgoing: [],
    tags: [],
    recommendation: {
      verdict: 'safe',
      ahead: 0,
      behind: 3,
      canPull: true,
      reason: '可以直接快进到远程的 3 个提交。',
    },
    upstreamSha: 'sha-1',
    error: null,
    ...over,
  }
}

function withProject() {
  const db = openDatabase(':memory:')
  db.prepare(
    'INSERT INTO projects (id, name, path, category, is_own, added_at) VALUES (?,?,?,?,?,?)',
  ).run(1, 'p', 'D:/tmp/p', 'tools', 0, new Date().toISOString())
  return db
}

describe('repo_state：当前状态的唯一一份', () => {
  it('合格的一次同步写入全部结论，提交列表只留前几条', () => {
    const db = withProject()
    writeRepoState(db, 1, report(), '2026-10-17T10:00:00Z')

    const state = readRepoState(db, 1)!
    expect(state).toMatchObject({
      projectId: 1,
      checkedAt: '2026-10-17T10:00:00Z',
      status: 'behind',
      behind: 3,
      verdict: 'safe',
      canPull: true,
      upstreamSha: 'sha-1',
      error: null,
    })
    // 行内够用几条就存几条：这张表是当前状态，不是提交列表的存档
    expect(state.incoming).toHaveLength(INCOMING_KEEP)
    expect(state.incoming[0]?.shortHash).toBe('h0')
    db.close()
  })

  it('失败的一次**不擦**上次的好结论，只记尝试与原因', () => {
    const db = withProject()
    writeRepoState(db, 1, report(), '2026-10-17T10:00:00Z')
    writeRepoState(
      db,
      1,
      report({
        status: 'error',
        ahead: null,
        behind: null,
        recommendation: null,
        upstreamSha: null,
        incoming: [],
        error: { kind: 'network', message: '连不上远程' },
      }),
      '2026-10-17T11:00:00Z',
    )

    const state = readRepoState(db, 1)!
    // 结论停在 10:00 那次
    expect(state.checkedAt).toBe('2026-10-17T10:00:00Z')
    expect(state.status).toBe('behind')
    expect(state.behind).toBe(3)
    expect(state.verdict).toBe('safe')
    // 失败本身看得见
    expect(state.attemptAt).toBe('2026-10-17T11:00:00Z')
    expect(state.error).toContain('连不上远程')
    db.close()
  })

  it('从没成功过的仓库：失败也落一行，读出来是「试过但没结论」', () => {
    const db = withProject()
    writeRepoState(db, 1, report({ status: 'error', ahead: null, behind: null, recommendation: null }))

    const state = readRepoState(db, 1)!
    expect(state.status).toBe('error')
    expect(state.ahead).toBeNull()
    expect(state.behind).toBeNull()
    expect(state.verdict).toBeNull()
    expect(state.canPull).toBe(false)
    expect(state.incoming).toEqual([])
    db.close()
  })

  it('没同步过的仓库就是没有行（null ≠ 一行空的）', () => {
    const db = withProject()
    expect(readRepoState(db, 1)).toBeNull()
    expect(readRepoStates(db, [1]).size).toBe(0)
    db.close()
  })

  it('批量读按 project_id 索引，可只取指定的几个', () => {
    const db = withProject()
    db.prepare(
      'INSERT INTO projects (id, name, path, category, is_own, added_at) VALUES (?,?,?,?,?,?)',
    ).run(2, 'q', 'D:/tmp/q', 'tools', 0, new Date().toISOString())
    writeRepoState(db, 1, report())
    writeRepoState(db, 2, report({ status: 'up_to_date', behind: 0 }))

    expect([...readRepoStates(db, [1, 2]).keys()]).toEqual([1, 2])
    expect([...readRepoStates(db, [2]).keys()]).toEqual([2])
    expect(readRepoStates(db).size).toBe(2)
    db.close()
  })
})
