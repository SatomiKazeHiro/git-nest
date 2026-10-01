import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getRepoStatus } from '../../src/git/status.ts'
import { gitSpawnCount, resetGitSpawnCount } from '../../src/git/runner.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

/**
 * 每个仓库读一次状态要起几个 git 子进程。
 *
 * Windows 上每条 git 命令几百毫秒，所以这个数字直接决定批量操作的耗时：
 * 100 个仓库 × 7 条 = 约 700 次进程启动。原来读状态要跑 7–8 条
 * （porcelain、rev-parse HEAD、symbolic-ref、上游、rev-list、remote、log），
 * 现在合并成「`status --porcelain=v2 --branch` + remote + log」3 条。
 *
 * 这条测试是**防回归**用的：以后谁往 readStatus 里加探针，数字涨上去就会红。
 * 上限给得比实际松一点，只拦住「又变回七八条」这种量级的变化。
 */

const dirs: string[] = []
const track = <T>(d: T): T => (dirs.push(d as unknown as string), d)
afterAll(() => cleanup(...dirs))

async function spawnsFor(dir: string): Promise<number> {
  resetGitSpawnCount()
  await getRepoStatus(dir)
  return gitSpawnCount()
}

describe('读状态的 git 子进程数', () => {
  it('干净、无远程：不超过 3 条', async () => {
    const dir = track(initRepo())
    expect(await spawnsFor(dir)).toBeLessThanOrEqual(3)
  })

  it('有远程、有上游：不超过 3 条（上游与领先/落后不额外起进程）', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    expect(await spawnsFor(clone)).toBeLessThanOrEqual(3)
  })

  it('落后（已 fetch）：同样不超过 3 条', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    expect(await spawnsFor(clone)).toBeLessThanOrEqual(3)
  })

  it('脏工作区：不超过 3 条', async () => {
    const dir = track(initRepo())
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x')
    expect(await spawnsFor(dir)).toBeLessThanOrEqual(3)
  })

  it('不是仓库的目录：一条就够（预检已去掉）', async () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-')))
    expect(await spawnsFor(dir)).toBeLessThanOrEqual(1)
  })

  it('批量 5 个仓库的总进程数随之线性', async () => {
    const dirsToCheck = Array.from({ length: 5 }, (_, i) => track(initRepo(`c${i}`)))
    resetGitSpawnCount()
    for (const d of dirsToCheck) await getRepoStatus(d)
    expect(gitSpawnCount()).toBeLessThanOrEqual(15)
  })
})
