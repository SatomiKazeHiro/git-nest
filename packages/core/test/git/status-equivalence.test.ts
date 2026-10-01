import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getRepoStatus } from '../../src/git/status.ts'
import { readRepoStatus } from '../../src/git/inspect/index.ts'
import { cleanup, commit, git, initClone, initRepo, tempDir } from '../helpers/repo.ts'

/**
 * `getRepoStatus` 的**行为等价表**。
 *
 * 这一组是性能重构的安全网：它不关心实现怎么取数，只钉住「每个场景下，
 * 状态机给出什么结论」。重构前必须先全绿，重构后必须一字不变。
 *
 * 每个场景断言完整的 RepoStatus 关键字段，而不是只看 status 一个枚举 ——
 * 因为换实现最容易悄悄改掉的是 branch / upstream / ahead / behind / dirtyCount
 * 这些「顺带得到」的字段。
 *
 * 下面这一整张表跑的都是 **full 档**（详情页与 pull 前置检查用的那一档）。
 * lean 档（列表页）在表末尾单独钉：它**有意**不读工作区与最后提交。
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

  it('最后提交：full 档读得到 hash / subject / author', async () => {
    const dir = track(initRepo('第一条提交'))
    const status = await getRepoStatus(dir)
    expect(status.lastCommit).toMatchObject({ subject: '第一条提交', author: 'git-nest test' })
    expect(status.lastCommit?.hash).toMatch(/^[0-9a-f]{7,}$/)
  })
})

/**
 * lean 档（列表页）的表。
 *
 * 它**有意**少读两条事实：工作区（dirty/dirtyCount）与最后提交（lastCommit）。
 * 列表页那一列只画分支、↑↓ 和一句话状态，这两条根本没人看，
 * 却要为每个仓库各起一次 git.exe —— 100 个仓库就是 7.8 秒里的大半。
 *
 * 所以这里钉的不是「和 full 一样」，而是「**只差这两条**」：
 * 下面每个用例都同时跑 full 和 lean，逐字段比对，把差异限制在预期之内。
 */
describe('lean 档只少读工作区与最后提交', () => {
  /** 同一场景跑两档，返回两边的 shape */
  async function both(dir: string) {
    const [full, lean] = [await readRepoStatus(dir, { profile: 'full' }), await readRepoStatus(dir, { profile: 'lean' })]
    return { full, lean, sf: shape(full), sl: shape(lean) }
  }

  it('分支 / 上游 / 领先落后 / 结论：两档完全一致（干净仓库）', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    const { sf, sl } = await both(clone)
    expect(sl).toEqual(sf)
    expect(sl).toMatchObject({ branch: 'main', upstream: 'origin/main', behind: 1, status: 'behind' })
  })

  it('唯一的差异：lean 的 dirty/dirtyCount 归零、lastCommit 为 null，结论让位给远程状态', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    fs.writeFileSync(path.join(clone, 'dirty.txt'), 'x')

    const { full, lean, sf, sl } = await both(clone)
    // 两档都知道自己落后，都知道身后有 1 个提交
    expect(sf).toMatchObject({ behind: 1, dirty: true, dirtyCount: 1, status: 'dirty' })
    expect(sl).toMatchObject({ behind: 1, dirty: false, dirtyCount: 0, status: 'behind' })
    expect(full.lastCommit).not.toBeNull()
    expect(lean.lastCommit).toBeNull()
    // 除了这三条，其余字段逐字节相同
    const { dirty: _fd, dirtyCount: _fc, status: _fs, ...restFull } = sf
    const { dirty: _ld, dirtyCount: _lc, status: _ls, ...restLean } = sl
    expect(restLean).toEqual(restFull)
  })

  it('仓库坏了、非仓库、目录不在：两档结论一致（这些不靠工作区判）', async () => {
    const notRepo = track(tempDir())
    const missing = track(path.join(tempDir(), 'nope'))
    for (const dir of [notRepo, missing]) {
      const { sf, sl } = await both(dir)
      expect(sl).toEqual(sf)
    }
  })

  it('空仓库：两档同为 no_commits（库在 resolveRef 上就否掉了）', async () => {
    const dir = track(tempDir())
    git(dir, 'init', '-b', 'main')
    const { sf, sl } = await both(dir)
    expect(sl).toEqual(sf)
    expect(sl).toMatchObject({ branch: 'main', status: 'no_commits' })
  })
})
