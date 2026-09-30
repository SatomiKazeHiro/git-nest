import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { pullRepo } from '../../src/git/pull.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

describe('pullRepo', () => {
  it('落后时只做 fast-forward', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交 1')
    commit(origin, '远程提交 2')
    git(clone, 'fetch', 'origin')
    const before = git(clone, 'rev-parse', 'HEAD').trim()

    const result = await pullRepo(clone)

    expect(result.outcome).toBe('updated')
    expect(result.newCommits).toBe(2)
    expect(result.summary).toContain('已更新 2 个提交')
    // 关键：ff-only 之后 HEAD 应该就是 origin/main，没有多出 merge commit
    expect(git(clone, 'rev-parse', 'HEAD').trim()).not.toBe(before)
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(git(clone, 'rev-parse', 'origin/main').trim())
    expect(git(clone, 'rev-list', '--count', '--merges', 'HEAD').trim()).toBe('0')
  })

  it('已是最新 → already_up_to_date', async () => {
    const { clone } = track(initClone(0))
    const result = await pullRepo(clone)
    expect(result.outcome).toBe('already_up_to_date')
    expect(result.newCommits).toBe(0)
    expect(result.summary).toBe('已是最新')
  })

  it('工作区脏 → 跳过，不碰它', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    git(clone, 'fetch', 'origin')
    fs.writeFileSync(path.join(clone, 'file.txt'), '本地还没提交\n', 'utf8')
    const before = git(clone, 'rev-parse', 'HEAD').trim()

    const result = await pullRepo(clone)

    expect(result.outcome).toBe('skipped')
    expect(result.status).toBe('dirty')
    expect(result.reason).toContain('未提交')
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(before)
  })

  it('detached HEAD → 跳过', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    git(clone, 'fetch', 'origin')
    const first = git(clone, 'rev-parse', 'HEAD~0').trim()
    commit(clone, '本地提交')
    git(clone, 'checkout', '-q', first)

    const result = await pullRepo(clone)
    expect(result.outcome).toBe('skipped')
    expect(result.status).toBe('detached')
  })

  it('没有上游 → 跳过', async () => {
    const { origin, clone } = track(initClone(0))
    git(origin, 'checkout', '-q', '-b', 'other')
    commit(origin, '另一个分支')
    git(clone, 'fetch', 'origin')
    git(clone, 'checkout', '-q', '-b', 'solo')
    commit(clone, '只在本地')

    const result = await pullRepo(clone)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toContain('没有上游')
  })

  it('分叉 → 跳过，绝不产生 merge commit', async () => {
    const { origin, clone } = track(initClone(0))
    commit(clone, '本地提交')
    commit(origin, '远程提交')
    git(clone, 'fetch', 'origin')
    const head = git(clone, 'rev-parse', 'HEAD').trim()

    const result = await pullRepo(clone)

    expect(result.outcome).toBe('skipped')
    expect(result.status).toBe('diverged')
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(git(clone, 'rev-list', '--count', '--merges', 'HEAD').trim()).toBe('0')
  })

  it('没有远程 → 跳过', async () => {
    const dir = track(initRepo())
    const result = await pullRepo(dir)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toContain('没有上游')
  })

  it('远程连不上 → failed，并说清是网络问题', async () => {
    const dir = track(initRepo())
    git(dir, 'remote', 'add', 'origin', 'https://no-such-host.invalid/x.git')
    const result = await pullRepo(dir)

    expect(result.outcome).toBe('failed')
    expect(result.error?.kind).toBe('network')
    expect(result.summary).toContain('失败')
  })

  it('新开的本地分支：交给 pull 报真实原因，而不是被前置检查拦下', async () => {
    const { clone } = track(initClone(0))
    // 新建的本地分支本来就没有上游；之前的前置检查会直接跳过，
    // 那样「远程挂了」和「没设上游」就分不出来了
    git(clone, 'checkout', '-q', '-b', 'fresh')

    const result = await pullRepo(clone)
    expect(result.outcome).toBe('skipped')
    expect(result.status).toBe('no_upstream')
    expect(result.reason).toContain('没有上游')
  })

  it('空仓库 → 跳过', async () => {
    const dir = track(initClone(0).origin)
    const result = await pullRepo(dir)
    expect(['skipped', 'failed']).toContain(result.outcome)
  })
})
