import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Scheduler } from '../../src/git/scheduler.ts'
import { getRemoteUrl, getRepoStatus, getRepoStatuses, readRemoteUrl } from '../../src/git/status.ts'
import { cleanup, commit, git, initClone, initRepo, tempDir } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

/**
 * 「远程地址」这件事只有一个来源、一个答案。
 *
 * 从前它有两个来源：扫描预览走 `git remote get-url`（会套用 `url.<base>.insteadOf`
 * 改写），添加项目 / 导入走读 `.git/config` 的原文。绝大多数机器上两者一模一样，
 * 配了改写规则（把 `gh:` 或 SSH 前缀统一换成 https，gh / 镜像的常见配法）的机器上
 * 不一样 —— 于是**预览里显示的地址和入库后那条记录的地址可能对不上**，
 * 而详情页会不会给可点链接全看这个值。
 *
 * 现在统一取「git 真正会用的那个地址」，理由：改写规则多半就是把 SSH 换成 HTTPS，
 * 那正是能点开的那个；而且它和用户 `git remote -v` 看到的一致，出问题好对账。
 */
describe('readRemoteUrl：读的是 git 真正会用的地址', () => {
  it('套用 url.<base>.insteadOf 的改写（实测过的行为）', async () => {
    const dir = track(initRepo())
    git(dir, 'remote', 'add', 'origin', 'gh:someone/some-repo.git')
    git(dir, 'config', 'url.https://github.com/.insteadOf', 'gh:')

    // 配置文件里写的是 gh:someone/some-repo.git，
    // 但 git 联网时会用 https://github.com/...（`git remote -v` 显示的也是它）
    expect(await readRemoteUrl(dir)).toBe('https://github.com/someone/some-repo.git')
  })

  it('没有 origin → null（不是空串）', async () => {
    const dir = track(initRepo())
    expect(await readRemoteUrl(dir)).toBeNull()
  })

  it('不是仓库 → null，不抛错', async () => {
    const dir = track(tempDir())
    expect(await readRemoteUrl(dir)).toBeNull()
  })

  it('是**纯实现**：可以在同一个 key 的 schedule 里直接调，不会自锁', async () => {
    /*
      这条钉的是 R4 那个陷阱的结构性消除。原来只有一个 `getRemoteUrl`：它自己
      `scheduler.schedule`，server 侧为了「同仓库串行」又在外面包了一层 schedule，
      于是只能靠**故意不传 scheduler** 来避免同 key 自锁 —— 谁顺手把那个参数补上
      就是永久挂起。现在纯实现（readRemoteUrl）与调度外壳（getRemoteUrl）分开了，
      调用方用哪一半是有明文约定的：在外层排队就用纯的那个。
    */
    const dir = track(initRepo())
    git(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git')
    const scheduler = new Scheduler()

    const url = await scheduler.schedule(dir, () => readRemoteUrl(dir))
    expect(url).toBe('https://example.invalid/x.git')
  })

  it('外壳仍然自己排队（getRemoteUrl 保留原形）', async () => {
    const dir = track(initRepo())
    git(dir, 'remote', 'add', 'origin', 'https://example.invalid/y.git')
    expect(await getRemoteUrl(dir, { scheduler: new Scheduler() })).toBe(
      'https://example.invalid/y.git',
    )
  })
})

describe('getRepoStatus', () => {
  it('干净的仓库：分支 main、无远程', async () => {
    const dir = track(initRepo())
    const status = await getRepoStatus(dir)

    expect(status.isRepo).toBe(true)
    expect(status.branch).toBe('main')
    expect(status.detached).toBe(false)
    expect(status.dirty).toBe(false)
    expect(status.dirtyCount).toBe(0)
    expect(status.remoteUrl).toBeNull()
    expect(status.status).toBe('no_remote')
    expect(status.lastCommit?.subject).toBe('first commit')
    expect(status.error).toBeNull()
  })

  it('工作区有改动 → dirty', async () => {
    const dir = track(initRepo())
    git(dir, 'config', 'remote.origin.url', 'https://example.invalid/x.git')
    fs.writeFileSync(path.join(dir, 'file.txt'), '改了\n', 'utf8')

    const status = await getRepoStatus(dir)
    expect(status.dirty).toBe(true)
    expect(status.dirtyCount).toBe(1)
    // dirty 优先于远程状态：先说「你还没提交」
    expect(status.status).toBe('dirty')
  })

  it('有远程、有上游、没 fetch → up_to_date', async () => {
    const { clone } = track(initClone(0))
    const status = await getRepoStatus(clone)
    expect(status.upstream).toBe('origin/main')
    expect(status.ahead).toBe(0)
    expect(status.behind).toBe(0)
    expect(status.status).toBe('up_to_date')
  })

  it('远程有新提交（已 fetch）→ behind', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程更新')
    git(clone, 'fetch', 'origin')

    const status = await getRepoStatus(clone)
    expect(status.behind).toBe(1)
    expect(status.ahead).toBe(0)
    expect(status.status).toBe('behind')
  })

  it('本地有新提交 → ahead', async () => {
    const { clone } = track(initClone(0))
    commit(clone, '本地提交')

    const status = await getRepoStatus(clone)
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(0)
    expect(status.status).toBe('ahead')
  })

  it('两边都有提交 → diverged', async () => {
    const { origin, clone } = track(initClone(0))
    commit(clone, '本地提交')
    commit(origin, '远程提交')
    git(clone, 'fetch', 'origin')

    const status = await getRepoStatus(clone)
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(1)
    expect(status.status).toBe('diverged')
  })

  it('detached HEAD 是常态，不是错误', async () => {
    const dir = track(initRepo())
    const first = git(dir, 'rev-parse', 'HEAD').trim()
    commit(dir, '第二个提交')
    git(dir, 'checkout', '-q', first)

    const status = await getRepoStatus(dir)
    expect(status.detached).toBe(true)
    expect(status.branch).toBeNull()
    expect(status.status).toBe('detached')
    expect(status.error).toBeNull()
  })

  it('本地分支没有上游 → no_upstream', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程加了个分支')
    git(clone, 'fetch', 'origin')
    git(clone, 'checkout', '-q', '-b', 'local-only')
    commit(clone, '只在本地')

    const status = await getRepoStatus(clone)
    expect(status.branch).toBe('local-only')
    expect(status.upstream).toBeNull()
    expect(status.remoteUrl).not.toBeNull()
    expect(status.status).toBe('no_upstream')
  })

  it('远程分支被删掉（prune 之后）→ gone', async () => {
    const { origin, clone } = track(initClone(0))
    git(origin, 'checkout', '-q', '-b', 'doomed')
    commit(origin, 'doomed 的提交')
    git(clone, 'fetch', 'origin')
    git(clone, 'checkout', '-q', '--track', 'origin/doomed')

    git(origin, 'checkout', '-q', 'main')
    git(origin, 'branch', '-D', 'doomed')
    git(clone, 'fetch', '--prune', 'origin')

    const status = await getRepoStatus(clone)
    expect(status.branch).toBe('doomed')
    // 原来的断言是 `upstream === null || upstreamGone` —— upstreamGone 恒为 false，
    // 所以它只可能靠 upstream === null 通过，和「没有上游」那条测的是同一件事。
    // 现在钉死：这确实是「上游被删」，而不是「从来没配过上游」。
    expect(status.upstreamGone).toBe(true)
    expect(status.status).toBe('gone')
  })

  it('目录不存在 → missing', async () => {
    const status = await getRepoStatus(path.join(tempDir(), 'nope'))
    expect(status.isRepo).toBe(false)
    expect(status.status).toBe('missing')
    expect(status.error?.kind).toBe('missing')
  })

  it('不是仓库的目录 → not_a_repo', async () => {
    const dir = track(tempDir())
    const status = await getRepoStatus(dir)
    expect(status.isRepo).toBe(false)
    expect(status.status).toBe('not_a_repo')
    expect(status.error?.kind).toBe('not_a_repo')
  })

  it('空仓库（还没有提交）→ no_commits', async () => {
    const dir = track(tempDir())
    git(dir, 'init', '-b', 'main')

    const status = await getRepoStatus(dir)
    expect(status.isRepo).toBe(true)
    expect(status.branch).toBe('main')
    expect(status.status).toBe('no_commits')
    expect(status.lastCommit).toBeNull()
  })

  it('批量查状态：跨仓库并发，结果各自独立', async () => {
    const a = track(initRepo('a'))
    const b = track(initRepo('b'))
    const statuses = await getRepoStatuses([a, b, path.join(tempDir(), 'missing')])

    expect(statuses).toHaveLength(3)
    expect(statuses[0]?.lastCommit?.subject).toBe('a')
    expect(statuses[1]?.lastCommit?.subject).toBe('b')
    expect(statuses[2]?.status).toBe('missing')
  })
})
