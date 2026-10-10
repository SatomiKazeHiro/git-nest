import { describe, expect, it, beforeEach } from 'vitest'
import { openDatabase, type DB } from '../src/db/index.ts'
import { insertProject, listProjects } from '../src/repos/projects.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 「这个仓库现在该不该动」——从**最近一次真正问到远程结论**的那次检查推出来的分类。
 *
 * 这个任务不造真实仓库：它只关心「检查记录 → 分类」这条映射，直接往库里插行。
 * 判定必须落在服务端，因为列表显示、状态筛选、侧栏计数三处都要用它，
 * 各写一份必然漂开。
 */

let db: DB

const dir = (name: string) => {
  const p = path.join(fs.realpathSync(os.tmpdir()), `attn-${name}`)
  fs.mkdirSync(p, { recursive: true })
  return p
}

const addProject = (name: string, category = '') =>
  insertProject(db, { name, path: dir(name), remoteUrl: null, isOwn: false, category, record: '' })

function addCheck(
  id: number,
  status: string,
  behind: number | null,
  detail: unknown,
  at = '2026-10-05T00:00:00.000Z',
) {
  db.prepare(
    `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
     VALUES (?, ?, ?, 0, ?, ?)`,
  ).run(id, at, status, behind, detail === null ? null : JSON.stringify(detail))
}

beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('attention 分类', () => {
  it('没有合格检查 → unchecked', () => {
    addProject('a')
    expect(listProjects(db)[0]!.attention).toBe('unchecked')
  })

  it('safe 且可拉 → ready', () => {
    const id = addProject('b')
    addCheck(id, 'behind', 3, { verdict: 'safe', canPull: true })
    expect(listProjects(db)[0]!.attention).toBe('ready')
  })

  it('safe 但没东西可拉 → synced', () => {
    const id = addProject('c')
    addCheck(id, 'up_to_date', 0, { verdict: 'safe', canPull: false })
    expect(listProjects(db)[0]!.attention).toBe('synced')
  })

  it.each([
    ['rewritten', 'blocked'],
    ['unrelated', 'blocked'],
    ['diverged', 'decide'],
  ] as const)('verdict %s → %s', (verdict, want) => {
    const id = addProject('v-' + verdict)
    addCheck(id, 'behind', 3, { verdict, canPull: false })
    expect(listProjects(db)[0]!.attention).toBe(want)
  })

  it('**检查失败的那次不算数**（不变量：断网后不能刷新出「刚确认过的已是最新」）', () => {
    const id = addProject('e')
    addCheck(id, 'up_to_date', 0, { verdict: 'safe', canPull: false }, '2026-10-05T00:00:00.000Z')
    // 后面这次是 error，不在 REMOTE_CHECK_STATUSES 里
    addCheck(id, 'error', null, null, '2026-10-06T00:00:00.000Z')
    expect(listProjects(db)[0]!.attention).toBe('synced')
  })

  it('**中间那次不合格的检查不污染分类**：取最新的**合格**那次', () => {
    const id = addProject('f')
    addCheck(id, 'diverged', 1, { verdict: 'diverged', canPull: false }, '2026-10-05T00:00:00.000Z')
    addCheck(id, 'error', null, null, '2026-10-06T00:00:00.000Z')
    expect(listProjects(db)[0]!.attention).toBe('decide')
  })

  it('旧的检查记录没有 verdict 字段 → unchecked，不编一条出来', () => {
    const id = addProject('g')
    addCheck(id, 'behind', 3, { upstreamSha: 'abc' })
    expect(listProjects(db)[0]!.attention).toBe('unchecked')
  })

  it('**库里还有 personal 分类的旧行** → 读得出来，不炸', () => {
    // 分类枚举改成不含 personal 之后，老库里的 personal 行还在
    const id = addProject('legacy', 'personal')
    addCheck(id, 'behind', 3, { verdict: 'safe', canPull: true })
    const p = listProjects(db).find((x) => x.id === id)!
    expect(p.category).toBe('personal') // 原样返回，显示层再决定怎么显示
    expect(p.attention).toBe('ready') // 且不影响分类判定
  })
})

describe('按分类筛选', () => {
  const mk = (n: string, s: string, behind: number, detail: unknown) => {
    const id = addProject(n)
    addCheck(id, s, behind, detail)
    return id
  }

  it('只返回选中的分类，且每一行的 attention 都对得上', () => {
    mk('r1', 'behind', 3, { verdict: 'safe', canPull: true })
    mk('r2', 'diverged', 1, { verdict: 'diverged', canPull: false })
    mk('s1', 'behind', 5, { verdict: 'safe', canPull: true })

    const onlyReady = listProjects(db, { attention: ['ready'] })
    expect(onlyReady.map((p) => p.name).sort()).toEqual(['r1', 's1'])
    // 筛出来的每一行，分类必须就是筛的那个（显示与筛选共用一份判定的回归）
    expect(onlyReady.every((p) => p.attention === 'ready')).toBe(true)
  })

  it('多个分类之间是「或」', () => {
    mk('r1', 'behind', 3, { verdict: 'safe', canPull: true })
    mk('b1', 'behind', 2, { verdict: 'unrelated', canPull: false })
    mk('d1', 'diverged', 1, { verdict: 'diverged', canPull: false })

    expect(
      listProjects(db, { attention: ['ready', 'blocked'] }).map((p) => p.name).sort(),
    ).toEqual(['b1', 'r1'])
  })

  it('筛 unchecked 时，没检查记录的项目都在', () => {
    const id = addProject('never')
    expect(listProjects(db, { attention: ['unchecked'] }).map((p) => p.id)).toEqual([id])
  })
})

describe('排序', () => {
  beforeEach(() => {
    const mk = (n: string, behind: number, at: string) => {
      const id = addProject(n)
      addCheck(id, 'behind', behind, { verdict: 'safe', canPull: true }, at)
    }
    mk('ccc', 1, '2026-10-05T00:00:00.000Z')
    mk('aaa', 9, '2026-10-06T00:00:00.000Z')
    mk('bbb', 5, '2026-10-04T00:00:00.000Z')
  })

  it('按名称', () => {
    expect(listProjects(db, { sort: 'name' }).map((p) => p.name)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('按落后数：多的在前', () => {
    expect(listProjects(db, { sort: 'behind' }).map((p) => p.name)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('按上次检查：新的在前', () => {
    expect(listProjects(db, { sort: 'checked' }).map((p) => p.name)).toEqual(['aaa', 'ccc', 'bbb'])
  })

  it('没查过的项目在任何排序里都排最后，不占前面', () => {
    addProject('zzz')
    const names = listProjects(db, { sort: 'checked' }).map((p) => p.name)
    expect(names[names.length - 1]).toBe('zzz')
  })
})
