import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getRepoStatus, getRepoStatuses } from '../../src/git/status.ts'
import { cleanup, commit, git, initClone, initRepo, tempDir } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

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
