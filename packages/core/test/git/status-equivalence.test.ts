import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getRepoStatus } from '../../src/git/status.ts'
import { cleanup, commit, git, initClone, initRepo, tempDir } from '../helpers/repo.ts'

/**
 * `getRepoStatus` 的**行为等价表**。
 *
 * 这一组是性能重构（把 6–7 条 git 命令合并成 2 条）的安全网：它不关心实现怎么
 * 取数，只钉住「每个场景下，状态机给出什么结论」。重构前必须先全绿，
 * 重构后必须一字不变。
 *
 * 每个场景断言完整的 RepoStatus 关键字段，而不是只看 status 一个枚举 ——
 * 因为合并命令最容易悄悄改掉的是 branch / upstream / ahead / behind / dirtyCount
 * 这些「顺带得到」的字段。
 */

const dirs: string[] = []
const track = <T>(d: T): T => (dirs.push(d as unknown as string), d)
afterAll(() => cleanup(...dirs))

/** 只比较我们关心的字段，path/checkedAt/lastCommit 的细节单独用例管 */
function shape(s: Awaited<ReturnType<typeof getRepoStatus>>) {
  return {
    isRepo: s.isRepo,
    branch: s.branch,
    detached: s.detached,
    dirty: s.dirty,
    dirtyCount: s.dirtyCount,
    upstream: s.upstream,
    upstreamGone: s.upstreamGone,
    ahead: s.ahead,
    behind: s.behind,
    status: s.status,
    errorKind: s.error?.kind ?? null,
  }
}

describe('状态行为等价表', () => {
  it('目录不存在 → missing', async () => {
    const status = await getRepoStatus(path.join(tempDir(), 'nope'))
    expect(shape(status)).toMatchObject({ isRepo: false, status: 'missing', errorKind: 'missing' })
  })

  it('不是仓库 → not_a_repo', async () => {
    const status = await getRepoStatus(track(tempDir()))
    expect(shape(status)).toMatchObject({ isRepo: false, status: 'not_a_repo' })
  })

  it('空仓库（没有提交）→ no_commits，branch 有名字', async () => {
    const dir = track(tempDir())
    git(dir, 'init', '-b', 'main')
    const status = await getRepoStatus(dir)
    expect(shape(status)).toMatchObject({
      isRepo: true,
      branch: 'main',
      detached: false,
      dirty: false,
      status: 'no_commits',
    })
  })

  it('干净、无远程 → no_remote', async () => {
    const status = await getRepoStatus(track(initRepo()))
    expect(shape(status)).toMatchObject({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: null,
      behind: null,
      status: 'no_remote',
    })
  })

  it('脏工作区 → dirty，dirtyCount 数出改动文件数', async () => {
    const dir = track(initRepo())
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
    const status = await getRepoStatus(dir)
    expect(shape(status)).toMatchObject({
      branch: 'main',
      dirty: true,
      dirtyCount: 2,
      status: 'dirty',
    })
  })

  it('有远程、有上游、已同步 → up_to_date，ahead/behind 都是 0', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    const status = await getRepoStatus(clone)
    expect(shape(status)).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      upstreamGone: false,
      ahead: 0,
      behind: 0,
      status: 'up_to_date',
    })
  })

  it('本地领先 → ahead', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(clone, '本地提交')
    const status = await getRepoStatus(clone)
    expect(shape(status)).toMatchObject({ ahead: 1, behind: 0, status: 'ahead' })
  })

  it('落后（已 fetch）→ behind', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    const status = await getRepoStatus(clone)
    expect(shape(status)).toMatchObject({ ahead: 0, behind: 1, status: 'behind' })
  })

  it('两边都有 → diverged', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(clone, '本地提交')
    commit(origin, '远程提交')
    git(clone, 'fetch')
    const status = await getRepoStatus(clone)
    expect(shape(status)).toMatchObject({ ahead: 1, behind: 1, status: 'diverged' })
  })

  it('detached HEAD → detached，branch 为 null', async () => {
    const dir = track(initRepo())
    git(dir, 'checkout', '-q', git(dir, 'rev-parse', 'HEAD').trim())
    const status = await getRepoStatus(dir)
    expect(shape(status)).toMatchObject({
      branch: null,
      detached: true,
      upstream: null,
      ahead: null,
      behind: null,
      status: 'detached',
    })
  })

  it('有远程但没配上游 → no_upstream', async () => {
    const dir = track(initRepo())
    git(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git')
    const status = await getRepoStatus(dir)
    expect(shape(status)).toMatchObject({
      branch: 'main',
      upstream: null,
      upstreamGone: false,
      status: 'no_upstream',
    })
  })

  it('上游被远程删掉 → gone，upstreamGone 为 true', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    git(clone, 'checkout', '-q', '-b', 'doomed')
    git(clone, 'push', '-q', '-u', 'origin', 'doomed')
    commit(clone, '分支上的提交')
    git(clone, 'push', '-q')
    git(origin, 'branch', '-D', 'doomed')
    git(clone, 'fetch', '--prune')

    const status = await getRepoStatus(clone)
    expect(shape(status)).toMatchObject({
      branch: 'doomed',
      upstreamGone: true,
      upstream: null,
      status: 'gone',
    })
  })

  it('脏 + 有上游：dirty 优先级高于 behind（deriveStatus 的顺序）', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    fs.writeFileSync(path.join(clone, 'dirty.txt'), 'x')

    const status = await getRepoStatus(clone)
    // status 取「更本地」的那个事实（dirty），但 ahead/behind 照样算出来
    // —— UI 上「落后 1」和「有未提交改动」会同时出现，这是有意的。
    expect(shape(status)).toMatchObject({ dirty: true, status: 'dirty', behind: 1 })
  })

  it('未跟踪文件也算脏', async () => {
    const dir = track(initRepo())
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x')
    const status = await getRepoStatus(dir)
    expect(shape(status)).toMatchObject({ dirty: true, dirtyCount: 1, status: 'dirty' })
  })
})
