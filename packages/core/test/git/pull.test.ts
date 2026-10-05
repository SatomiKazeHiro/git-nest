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

  it('工作区脏 → 跳过，不碰它，并说清是「你改过的文件」', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    git(clone, 'fetch', 'origin')
    fs.writeFileSync(path.join(clone, 'file.txt'), '本地还没提交\n', 'utf8')
    const before = git(clone, 'rev-parse', 'HEAD').trim()

    const result = await pullRepo(clone)

    expect(result.outcome).toBe('skipped')
    expect(result.status).toBe('dirty')
    // 以前一律说「有 N 处未提交改动」，现在分开说：这句是被改的**已跟踪文件**。
    // 用户要能分清「我改了东西」和「这只是构建产物」（后者单独一种说法）。
    expect(result.reason).toContain('已跟踪文件被改过')
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(before)
  })

  it('只有未跟踪文件 → 照样跳过，但别说成「你改过文件」', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    git(clone, 'fetch', 'origin')
    // 未跟踪的新文件：多半是构建产物
    fs.writeFileSync(path.join(clone, 'build-output.log'), 'x', 'utf8')

    const result = await pullRepo(clone)

    expect(result.outcome).toBe('skipped')
    expect(result.status).toBe('dirty')
    expect(result.reason).toContain('未跟踪文件')
    expect(result.reason).toContain('构建产物')
    expect(result.reason).not.toContain('已跟踪文件被改过')
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

/**
 * 「作者改写了历史」这道闸。
 *
 * 调用方（server 的 runApply）手上有一道基于**上次检查结论**的闸，但「检查」
 * 与「点更新」之间作者完全可能刚好 force push。那种情况本地 HEAD 仍是新历史的
 * 祖先（`recommend.ts` 文件头点名的限制），`pull --ff-only` 会毫无怨言地快进
 * ——静默更新到一个被改写的仓库。唯一抓得住它的是基线（上次见到的上游 SHA），
 * 而基线必须在 **fetch 之前**读：所以 pull 自己先 fetch 一遍再比，然后才动工作区。
 */
describe('pullRepo 的基线闸（判「作者改写了历史」）', () => {
  it('作者 force push 掉见过的提交 → 拒绝更新，工作区一个字节都不动', async () => {
    // origin 上先走两步，clone 落在初始提交上
    const { origin, clone } = track(initClone(2))
    git(clone, 'fetch', 'origin')
    // 这就是「上次检查时见到的上游」
    const baseline = git(clone, 'rev-parse', 'origin/main').trim()
    const before = git(clone, 'rev-parse', 'HEAD').trim()

    /*
      作者把远程回退一格、再提交别的东西 —— 对 clone 来说这就是一次 force push：
      `origin/main` 从 C2 变成了 C1'，而 C2 已经不在新历史里。
      （origin 是个普通本地仓库、没有 remote，所以直接在它身上改写 refs 即可，
      等价于在远端 force push。）
    */
    git(origin, 'reset', '--hard', 'HEAD~1')
    commit(origin, '被改写后的新历史')

    const result = await pullRepo(clone, { lastUpstreamSha: baseline })

    expect(result.outcome).toBe('skipped')
    expect(result.reason).toContain('改写过')
    expect(result.reason).toContain(baseline.slice(0, 7))
    // 关键：HEAD 没动，也没有产生 merge commit
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(before)
    expect(git(clone, 'rev-list', '--count', '--merges', 'HEAD').trim()).toBe('0')
  })

  it('正常的快进（基线仍是祖先）不受影响', async () => {
    const { origin, clone } = track(initClone(0))
    git(clone, 'fetch', 'origin')
    const baseline = git(clone, 'rev-parse', 'origin/main').trim()

    commit(origin, '远程正常往前走一格')

    const result = await pullRepo(clone, { lastUpstreamSha: baseline })

    expect(result.outcome).toBe('updated')
    expect(result.newCommits).toBe(1)
  })

  it('没有基线时行为不变（老调用方不受影响）', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    const result = await pullRepo(clone)
    expect(result.outcome).toBe('updated')
  })

  /*
    **假警报比「判不出来」坏得多。**
    SHA 属于**某一条**上游 ref，而库里记的值不带这个信息。在 main 上检查过、
    之后切到 feature 再更新时，拿 main 的 SHA 去问「它还在 feature 的历史里吗」，
    答案必然是否 —— 于是报「作者改写了历史，别拉」。作者什么都没干。
    所以基线优先取**本机现在指着的上游 ref**（天然属于当前这条线），
    传进来的那个值只在本地读不出来时兜底。
  */
  it('切到另一条分支后：属于旧分支的基线不造成假警报', async () => {
    const { origin, clone } = track(initClone(0))
    // main 往前走一格 —— 这就是「上次在 main 上检查时见到的上游」
    commit(origin, 'main 上的提交')
    git(clone, 'fetch', 'origin')
    const mainSha = git(clone, 'rev-parse', 'origin/main').trim()

    // feature 从**更早**的基点分出去（这样 mainSha 不是它的祖先）
    const base = git(origin, 'rev-parse', 'HEAD~1').trim()
    git(origin, 'checkout', '-q', '-b', 'feature', base)
    commit(origin, 'feature 上的提交', 'feature.txt')
    git(origin, 'checkout', '-q', 'main')

    git(clone, 'fetch', 'origin')
    git(clone, 'checkout', '-q', '-b', 'feature', 'origin/feature')

    const result = await pullRepo(clone, { lastUpstreamSha: mainSha })

    expect(result.outcome, '不属于当前分支的基线不该造成「改写过历史」').toBe('already_up_to_date')
  })
})
