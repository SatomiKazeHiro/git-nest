import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readRepoStatus, type StatusProfile } from '../../src/git/inspect/index.ts'
import { analyzeUpdates } from '../../src/git/log.ts'
import { gitSpawnCount, resetGitSpawnCount } from '../../src/git/runner.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

/**
 * 每个仓库读一次状态要起几个 git 子进程。
 *
 * Windows 上每条 git 命令约 70ms（20ms 是 CreateProcess 的地板），所以这个数字
 * 直接决定批量操作的耗时。历史上这里跑过 7–8 条命令，后来合并成 3 条，
 * 现在又按「列表页到底要看什么」分了两档：
 *
 * - `full`：ref/config 走库（0 进程）+ rev-list + status + log = **最多 3 条**
 * - `lean`：ref/config 走库（0 进程）+ rev-list = **最多 1 条**
 *
 * 这条测试是**防回归**用的：以后谁往读取路径里加探针，数字涨上去就会红。
 * 上限给得比实际松一点，只拦住「又变回七八条」这种量级的变化。
 */

const dirs: string[] = []
const track = <T>(d: T): T => (dirs.push(d as unknown as string), d)
afterAll(() => cleanup(...dirs))

async function spawnsFor(dir: string, profile: StatusProfile): Promise<number> {
  resetGitSpawnCount()
  await readRepoStatus(dir, { profile })
  return gitSpawnCount()
}

describe('读状态的 git 子进程数（full 档：详情页 / pull 前置检查）', () => {
  it('干净、无远程：不超过 3 条', async () => {
    const dir = track(initRepo())
    expect(await spawnsFor(dir, 'full')).toBeLessThanOrEqual(3)
  })

  it('有远程、有上游：不超过 3 条（分支/上游/地址都不起进程）', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    expect(await spawnsFor(clone, 'full')).toBeLessThanOrEqual(3)
  })

  it('落后（已 fetch）：同样不超过 3 条', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    expect(await spawnsFor(clone, 'full')).toBeLessThanOrEqual(3)
  })

  it('脏工作区：不超过 3 条', async () => {
    const dir = track(initRepo())
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x')
    expect(await spawnsFor(dir, 'full')).toBeLessThanOrEqual(3)
  })

  it('不是仓库的目录：一条都不用起（库读 .git 就否掉了）', async () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-')))
    expect(await spawnsFor(dir, 'full')).toBe(0)
  })

  it('批量 5 个仓库的总进程数随之线性', async () => {
    const dirsToCheck = Array.from({ length: 5 }, (_, i) => track(initRepo(`c${i}`)))
    resetGitSpawnCount()
    for (const d of dirsToCheck) await readRepoStatus(d, { profile: 'full' })
    expect(gitSpawnCount()).toBeLessThanOrEqual(15)
  })
})

describe('读状态的 git 子进程数（lean 档：列表页）', () => {
  it('有远程、有上游：只有 rev-list 一条', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    expect(await spawnsFor(clone, 'lean')).toBeLessThanOrEqual(1)
  })

  it('脏工作区：lean 档不看工作区，所以还是只有 rev-list 一条', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    fs.writeFileSync(path.join(clone, 'x.txt'), 'x')
    expect(await spawnsFor(clone, 'lean')).toBeLessThanOrEqual(1)
  })

  it('空仓库：一条都不用起（没提交就不必算领先/落后）', async () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-empty-')))
    git(dir, 'init', '-b', 'main')
    expect(await spawnsFor(dir, 'lean')).toBe(0)
  })

  it('不是仓库的目录：一条都不用起', async () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-not-a-repo-')))
    expect(await spawnsFor(dir, 'lean')).toBe(0)
  })
})

describe('批量检查一次更新的 git 子进程数', () => {
  /**
   * `analyzeUpdates` 比读状态更贵（它要真的 fetch）。原来的探针顺序是
   * `rev-parse --is-inside-work-tree` → `remote` → `tag` → `fetch` → `tag` →
   * `@{u}` → `rev-list` → 两段 `log` = 10 条；现在去掉了预检与单独的 `@{u}`。
   * 上限给得比实际松一点，只拦住「又变回十条」这种量级的变化。
   */
  async function analyzeSpawns(dir: string): Promise<number> {
    resetGitSpawnCount()
    await analyzeUpdates(dir)
    return gitSpawnCount()
  }

  it('落后：不超过 8 条', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    expect(await analyzeSpawns(clone)).toBeLessThanOrEqual(8)
  })

  it('不是仓库：1 条就够', async () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-not-a-repo-')))
    expect(await analyzeSpawns(dir)).toBeLessThanOrEqual(1)
  })

  it('没有 origin：2 条（不联网）', async () => {
    const dir = track(initRepo())
    expect(await analyzeSpawns(dir)).toBeLessThanOrEqual(2)
  })
})
