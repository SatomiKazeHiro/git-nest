import { afterAll, describe, expect, it } from 'vitest'
import { clearCommandLog, probe, recentCommands, runGit } from '../../src/git/runner.ts'
import { readRepoStatus } from '../../src/git/inspect/index.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

/**
 * 命令日志。
 *
 * 存在的理由：这个软件会**自己联网**（自动 fetch）。自动做的事如果不留痕，
 * 用户没法知道它跑了什么、什么时候跑的、有没有失败。用户明确要求了这一点
 * （「你可以自动 fetch，但你要记录所有执行过的命令下来，方便查看」）。
 *
 * 这里钉三件事：记下来了、记的内容够用（label / args / cwd / 退出码 / 耗时）、
 * 以及**有上限**（长时间跑的服务不能无限涨）。
 */

const dirs: string[] = []
const track = <T>(d: T): T => (dirs.push(d as unknown as string), d)
afterAll(() => cleanup(...dirs))

describe('命令日志', () => {
  it('每次 git 调用都留下一条，且记了这四件事', async () => {
    const dir = track(initRepo())
    clearCommandLog()

    await probe(['rev-parse', 'HEAD'], { cwd: dir, label: 'test-label' })

    const log = recentCommands()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ label: 'test-label', cwd: dir, code: 0 })
    // 实参记的是**去掉固定配置项之后**的（那些每条都一样，是噪音）
    expect(log[0]!.args).toEqual(['rev-parse', 'HEAD'])
    expect(log[0]!.args).not.toContain('credential.helper=')
    expect(log[0]!.ms).toBeGreaterThanOrEqual(0)
    expect(log[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('失败的命令也记，并带上退出码（排查时最需要的就是它）', async () => {
    const dir = track(initRepo())
    clearCommandLog()

    // 在一个不是仓库的目录里跑 git：必然非零退出
    await runGit(['status'], { cwd: dir, label: 'test' })

    const log = recentCommands()
    expect(log).toHaveLength(1)
    expect(log[0]!.code).toBe(0) // initRepo 是仓库，所以这条成功

    clearCommandLog()
    const result = await runGit(['log', '--verify-nonexistent-flag'], { cwd: dir, label: 'test' })
    expect(result.code).not.toBe(0)
    expect(recentCommands()[0]!.code).not.toBe(0)
  })

  it('label 会一路透传到读状态的底层命令上（没标签就只是一堆看不出上下文的命令）', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    clearCommandLog()

    await readRepoStatus(clone, { profile: 'full', label: 'auto-fetch' })

    const labels = new Set(recentCommands().map((e) => e.label))
    expect(recentCommands().length).toBeGreaterThan(0)
    expect([...labels]).toEqual(['auto-fetch'])
  })

  it('有上限：环形缓冲，不会无限涨', async () => {
    const dir = track(initRepo())
    clearCommandLog()
    // 1010 次调用超过 1000 的上限，超出部分应从**最旧的**开始丢
    for (let i = 0; i < 1010; i++) {
      await runGit(['rev-parse', '--verify', '-q', `HEAD~${i}`], { cwd: dir })
    }
    const log = recentCommands()
    expect(log.length).toBeLessThanOrEqual(1000)
    // 留下来的必须是最新的那批（最后一条是最后一次调用）
    expect(log[log.length - 1]!.args).toEqual(['rev-parse', '--verify', '-q', 'HEAD~1009'])
  }, 120_000)

  it('clearCommandLog 能清空', async () => {
    const dir = track(initRepo())
    clearCommandLog()
    await runGit(['rev-parse', 'HEAD'], { cwd: dir })
    expect(recentCommands().length).toBe(1)
    clearCommandLog()
    expect(recentCommands().length).toBe(0)
  })
})
