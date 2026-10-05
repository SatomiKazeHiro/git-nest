import { afterAll, describe, expect, it } from 'vitest'
import { getRepoStatus } from '../../src/git/status.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

/**
 * 「上游分支被远程删掉」是一个**必须能看见**的常态：用户以为推送失败是别的原因，
 * 实际是得重新 `git push -u`。
 *
 * 现在的实现靠解析 `@{u}` 的报错来判定。但实测：remote-tracking ref 被 prune 之后
 * `git rev-parse --abbrev-ref --symbolic-full-name @{u}` 直接 exit 128，于是
 * `upstream` 先变成 null、后面那段判定 `upstreamGone` 的分支根本不执行 —— 字段恒为 false。
 * 现有测试用 `upstream === null || upstreamGone` 逃逸，所以这条一直是绿的。
 *
 * git 自己有权威判据：`for-each-ref --format='%(upstream:track)'` 会给出 `[gone]`。
 */

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

/** 造出「上游配好了，但远程跟踪 ref 被删掉」的仓库。 */
function makeGoneUpstream(): string {
  const { origin, clone } = initClone(0)
  track(origin)
  track(clone)

  // 在 clone 里开一个带上游的分支并推上去
  git(clone, 'checkout', '-b', 'doomed')
  git(clone, 'push', '-u', 'origin', 'doomed')
  commit(clone, '分支上的提交')
  git(clone, 'push')

  // 远程删掉它，本地 prune 掉 remote-tracking ref
  git(origin, 'branch', '-D', 'doomed')
  git(clone, 'fetch', '--prune')

  return clone
}

describe('上游分支被远程删掉', () => {
  it('upstreamGone 为 true，且状态是 gone（不是含糊的 no_upstream）', async () => {
    const clone = makeGoneUpstream()
    const status = await getRepoStatus(clone)

    // 「上游被删」和「从来没配过上游」的下一步动作完全不同，不能混成一个状态
    expect(status.status).toBe('gone')
    expect(status.upstreamGone).toBe(true)
  })

  it('从来没配过上游的分支不能被误判成 gone', async () => {
    const dir = track(initRepo())
    // 配一个远程但不开上游
    git(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git')

    const status = await getRepoStatus(dir)
    expect(status.status).toBe('no_upstream')
    expect(status.upstreamGone).toBe(false)
  })

  it('正常的、上游健在的分支 gone 为 false', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)

    const status = await getRepoStatus(clone)
    expect(status.status).toBe('up_to_date')
    expect(status.upstreamGone).toBe(false)
  })

  /*
    上游指向**本机另一个分支**时（`git branch -u main feature` 写进 config 的是
    `remote = .` + `merge = refs/heads/main`），原实现去解析 `refs/remotes/./main`
    ——必然失败，于是报 `gone`「上游分支已经被远程删掉了」，而 gone 给用户的建议是
    「重新 push -u，不用了就删掉本地分支」。**假警报引向真破坏**：
    用户照做就删掉了自己的分支，而这仓库压根没有远程上游这回事。
  */
  it('上游是本机分支（remote = .）不是 gone', async () => {
    const dir = track(initRepo('主干'))
    git(dir, 'checkout', '-q', '-b', 'feature')
    commit(dir, '支线提交', 'side.txt')
    git(dir, 'branch', '-u', 'main', 'feature')

    const status = await getRepoStatus(dir)

    expect(status.upstreamGone).toBe(false)
    expect(status.status).not.toBe('gone')
    // 上游是 main：本地分支就是领先它的那个（feature 比 main 多一个提交）
    expect(status.upstream).toBe('main')
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(0)
  })
})
