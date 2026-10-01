import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeUpdates, statusFromCounts } from '../../src/git/log.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

describe('analyzeUpdates', () => {
  it('fetch 后发现远程的新提交与新 tag', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交 1')
    commit(origin, '远程提交 2')
    git(origin, 'tag', 'v9')
    fs.writeFileSync(path.join(origin, 'file.txt'), '改了\n', 'utf8')
    git(origin, 'add', '-A')
    git(origin, 'commit', '-m', '远程提交 3')

    const report = await analyzeUpdates(clone)

    expect(report.status).toBe('behind')
    expect(report.behind).toBe(3)
    expect(report.incoming).toHaveLength(3)
    expect(report.incoming[0]?.subject).toBe('远程提交 3')
    expect(report.incoming[0]?.shortHash).toMatch(/^[0-9a-f]{7,}$/)
    expect(report.outgoing).toEqual([])
    expect(report.tags).toEqual(['v9'])
    expect(report.error).toBeNull()
  })

  it('fetch 不会动工作区', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    fs.writeFileSync(path.join(clone, 'file.txt'), '本地未提交的改动\n', 'utf8')

    await analyzeUpdates(clone)

    expect(fs.readFileSync(path.join(clone, 'file.txt'), 'utf-8')).toBe('本地未提交的改动\n')
  })

  it('没有 origin 就直接返回 no_remote，不去联网', async () => {
    const dir = track(initRepo())
    const report = await analyzeUpdates(dir)
    expect(report.status).toBe('no_remote')
    expect(report.incoming).toEqual([])
    expect(report.error).toBeNull()
  })

  it('本地领先远程 → ahead，incoming 为空、outgoing 有内容', async () => {
    const { clone } = track(initClone(0))
    commit(clone, '我的本地提交')

    const report = await analyzeUpdates(clone)
    expect(report.status).toBe('ahead')
    expect(report.ahead).toBe(1)
    expect(report.incoming).toEqual([])
    expect(report.outgoing).toHaveLength(1)
    expect(report.outgoing[0]?.subject).toBe('我的本地提交')
  })

  it('两边都有提交 → diverged，两边各一条', async () => {
    const { origin, clone } = track(initClone(0))
    commit(clone, '本地提交')
    commit(origin, '远程提交')

    const report = await analyzeUpdates(clone)
    expect(report.status).toBe('diverged')
    expect(report.ahead).toBe(1)
    expect(report.behind).toBe(1)
    expect(report.incoming.map((c) => c.subject)).toEqual(['远程提交'])
    expect(report.outgoing.map((c) => c.subject)).toEqual(['本地提交'])
  })

  it('已经是最新 → up_to_date', async () => {
    const { clone } = track(initClone(0))
    const report = await analyzeUpdates(clone)
    expect(report.status).toBe('up_to_date')
    expect(report.behind).toBe(0)
  })

  it('远程地址不通 → 归因成 network，并说明原因', async () => {
    const dir = track(initRepo())
    git(dir, 'remote', 'add', 'origin', 'https://no-such-host.invalid/x.git')

    const report = await analyzeUpdates(dir)
    expect(report.status).toBe('error')
    expect(report.error?.kind).toBe('network')
    expect(report.error?.message).toContain('代理')
  })

  it('重复检查不会把同一个 tag 反复报成新的', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    git(origin, 'tag', 'v1')

    const first = await analyzeUpdates(clone)
    expect(first.tags).toEqual(['v1'])

    const second = await analyzeUpdates(clone)
    expect(second.tags).toEqual([])
  })
})

/**
 * `rev-list` 读不出来时（对象库损坏、超时、ref 冲突）**不能**报成「已是最新」。
 *
 * 原来的实现把探测失败当成 ahead=behind=null，三元链一路落到 'up_to_date'，
 * 而且 error 是 null —— 一个根本没读成功的仓库被说成最新，用户没有任何线索。
 * 这是最危险的假绿方向，所以把判定抽成纯函数，直接钉住语义。
 *
 * 注：特意不去造「损坏对象库 + fetch 成功」这种病态仓库来端到端触发 ——
 * 实测损坏对象会让 `git fetch` 自己先失败，走的是另一条分支，测试会假绿。
 */
describe('statusFromCounts', () => {
  it('两边都有 → diverged', () => {
    expect(statusFromCounts(2, 3)).toBe('diverged')
  })

  it('只有远程有 → behind', () => {
    expect(statusFromCounts(0, 3)).toBe('behind')
  })

  it('只有本地有 → ahead', () => {
    expect(statusFromCounts(2, 0)).toBe('ahead')
  })

  it('都没有 → up_to_date', () => {
    expect(statusFromCounts(0, 0)).toBe('up_to_date')
  })
})
