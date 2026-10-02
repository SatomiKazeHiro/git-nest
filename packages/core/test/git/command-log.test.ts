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
 *
 * ⚠️ **断言只认自己产生的那一条。**
 * 日志是模块级共享状态，而 vitest 默认**按文件并行**（同文件内用例串行）——
 * `apps/server` 那边的测试会同时往同一个日志里写。曾经这里断言
 * `recentCommands()` 的绝对长度，于是别的文件一并发就红（`expected 2 to be 1`），
 * 看起来像产品 bug，其实是测试不隔离。
 */

const dirs: string[] = []
const track = <T>(d: T): T => (dirs.push(d as unknown as string), d)
afterAll(() => cleanup(...dirs))

/** 只取这个 label 的条目——把并发写进来的别人的记录滤掉。 */
const onlyLabel = (label: string) => recentCommands().filter((e) => e.label === label)

describe('命令日志', () => {
  it('每次 git 调用都留下一条，且记了这几件事', async () => {
    const dir = track(initRepo())
    clearCommandLog()

    await probe(['rev-parse', 'HEAD'], { cwd: dir, label: 'test-one' })

    const mine = onlyLabel('test-one')
    expect(mine).toHaveLength(1)
    const entry = mine[0]!
    expect(entry).toMatchObject({ label: 'test-one', cwd: dir, code: 0 })
    // 实参记的是**去掉固定配置项之后**的（那些每条都一样，是噪音）
    expect(entry.args).toEqual(['rev-parse', 'HEAD'])
    expect(entry.args).not.toContain('credential.helper=')
    expect(entry.ms).toBeGreaterThanOrEqual(0)
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('失败的命令也记，并带上退出码（排查时最需要的就是它）', async () => {
    const dir = track(initRepo())
    clearCommandLog()

    const ok = await runGit(['rev-parse', 'HEAD'], { cwd: dir, label: 'test-fail' })
    expect(ok.code).toBe(0)
    expect(onlyLabel('test-fail').at(-1)!.code).toBe(0)

    const bad = await runGit(['log', '--verify-nonexistent-flag'], { cwd: dir, label: 'test-fail' })
    expect(bad.code).not.toBe(0)
    expect(onlyLabel('test-fail').at(-1)!.code).not.toBe(0)
  })

  it('label 会一路透传到读状态的底层命令上（没标签就只是一堆看不出上下文的命令）', async () => {
    const { origin, clone } = initClone(0)
    track(origin)
    track(clone)
    commit(origin, '远程提交')
    git(clone, 'fetch')
    clearCommandLog()

    await readRepoStatus(clone, { profile: 'full', label: 'auto-fetch' })

    const mine = onlyLabel('auto-fetch')
    // 读一次状态会跑好几条命令，全部都要带上这个 label
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((e) => e.cwd === clone)).toBe(true)
  })

  it('有上限：环形缓冲，不会无限涨', async () => {
    const dir = track(initRepo())
    clearCommandLog()
    // 1010 次调用超过 1000 的上限，超出部分应从**最旧的**开始丢
    for (let i = 0; i < 1010; i++) {
      await runGit(['rev-parse', '--verify', '-q', `HEAD~${i}`], { cwd: dir, label: 'test-ring' })
    }
    const log = recentCommands()
    expect(log.length).toBeLessThanOrEqual(1000)
    // 留下来的必须是最新的那批：最后一次调用还在（哪怕期间有别人写进来）
    const mine = onlyLabel('test-ring')
    expect(mine.at(-1)!.args).toEqual(['rev-parse', '--verify', '-q', 'HEAD~1009'])
    // 而最旧的那些已经被挤掉了
    expect(mine.some((e) => e.args.at(-1) === 'HEAD~0')).toBe(false)
  }, 120_000)

  it('clearCommandLog 能清空', async () => {
    const dir = track(initRepo())
    clearCommandLog()
    // 清空是同步的，所以清完立刻看必须是空的（并发写入是异步的，跑不过这一行）
    expect(recentCommands().length).toBe(0)

    await runGit(['rev-parse', 'HEAD'], { cwd: dir, label: 'test-clear' })
    expect(onlyLabel('test-clear')).toHaveLength(1)

    clearCommandLog()
    expect(recentCommands().length).toBe(0)
  })
})
