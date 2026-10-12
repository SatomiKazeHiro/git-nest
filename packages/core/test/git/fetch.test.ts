import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  FETCH_REFSPEC,
  composeFetchFailure,
  deriveAlternativeRemote,
  fallbackTimeoutMs,
  fetchRemote,
  fetchWithFallback,
  withOtherRouteHint,
  type FetchRemoteOptions,
  type FetchRemoteResult,
} from '../../src/git/fetch.ts'
import {
  clearCommandLog,
  gitSpawnCount,
  recentCommands,
  resetGitSpawnCount,
} from '../../src/git/runner.ts'
import { cleanup, commit, git, initClone, initRepo } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

/*
  每条用例都从零开始：`recentCommands()` 是**累积**的环形缓冲（最近 1000 条，
  不按用例清），`gitSpawnCount()` 也是全局计数。不清的话，「这次跑了几条 fetch」
  会读到前面用例留下的条目——那正是第一版这里踩到的坑（数出 6 条）。
  这两个钩子本来就是给测试用的，清它们不算放松断言。
*/
beforeEach(() => {
  resetGitSpawnCount()
  clearCommandLog()
})

const read = (dir: string, ...args: string[]): string => git(dir, ...args).trim()

/**
 * 不抛错的 `git`：**要判「引用没了」就必须用它**。
 *
 * 为什么不能拿 `git()` 去验「origin/gone 已经消失」：那个辅助是 `execFileSync`
 * 且不吞非零退出——引用真的消失时它**抛异常**，而「抛异常」恰恰是这条用例想要的
 * 状态。用会抛的辅助去断言「不存在」，等于断言反了。
 * 这里把退出码如实返回来，断言「退出码非 0」+「for-each-ref 里没有它」。
 */
function tryGit(dir: string, ...args: string[]): { code: number; stdout: string } {
  try {
    return { code: 0, stdout: git(dir, ...args) }
  } catch (err) {
    /*
      `execFileSync` 失败时抛出的 Error 上带 `status`（退出码）与 `stdout`。
      两者都宽一点取：`status` 缺失（不同 Node 版本/被杀掉的进程）时退回 1，
      只要不是 0 就能表达「这条命令没成功」。
    */
    const e = err as { status?: number; code?: number | string; stdout?: string | Buffer }
    const status = typeof e.status === 'number' ? e.status : typeof e.code === 'number' ? e.code : 1
    return { code: status, stdout: String(e.stdout ?? '') }
  }
}

/** 远程跟踪引用的全名清单（不含其它 refs），用来判「prune 掉了没有」。 */
function remoteBranchRefs(dir: string): string[] {
  return git(dir, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * 假执行器：**不碰网络、不跑 git**，把每次「fetched 什么」如实记下来。
 *
 * 为什么必须有这个接缝：换路的判据是**网络事实**（这条通、那条不通），而真网络上
 * 这台机器可能正好是 github:443 通 / SSH 不通——于是「两条都失败」根本不成立，
 * 用例变成看运气（第一版就是这样，跑了 23.7 秒真网络）。注入之后，
 * 「哪条路先试、试了几次、换路那一档超时是多少」全是确定性的。
 *
 * **代价要说清**：假执行器验不了「命令怎么拼、refs 有没有真的前进」——
 * 那两条必须由真 git 的用例守着（见下面 `fetchRemote` 的两个用例），
 * 不能让假执行器把真实验收点也一起顶掉。
 */
function fakeExecutor(failing: Set<string> | 'all' | 'none') {
  const calls: FetchRemoteOptions[] = []
  const execute = async (options: FetchRemoteOptions): Promise<FetchRemoteResult> => {
    calls.push(options)
    const fails =
      failing === 'all' ? true : failing === 'none' ? false : failing.has(options.url)
    if (!fails) return { ok: true, code: 0, stderr: '', timedOut: false }
    /*
      文案里带上**走的是哪条路**，因为真实 stderr 本来就带 URL
      （`fatal: unable to access 'https://...'`）。而 `composeFetchFailure` 按文案去重
      ——两条路都回同一句话时只报一条是对的，所以这里必须让两条的文案不同，
      才能验到「两条都报出来」。这不是为了迁就实现，是夹具要像真 git 的输出。
    */
    return {
      ok: false,
      code: 128,
      stderr: `fatal: unable to access '${options.url}': Could not resolve host`,
      timedOut: false,
      // 走真实的归因种类，只是不真的起进程
      error: {
        kind: 'network',
        message: `连不上远程（${options.transport}）。检查网络、代理或 DNS`,
      },
    }
  }
  return { execute, calls }
}

describe('deriveAlternativeRemote', () => {
  it('https 地址（带 .git）→ SSH 形式', () => {
    expect(deriveAlternativeRemote('https://github.com/someone/some-repo.git')).toBe(
      'git@github.com:someone/some-repo.git',
    )
  })

  it('https 地址（不带 .git）→ 规范形式照样带 .git', () => {
    expect(deriveAlternativeRemote('https://github.com/someone/some-repo')).toBe(
      'git@github.com:someone/some-repo.git',
    )
  })

  it('末尾斜杠与前后空白不当成另一条路径', () => {
    expect(deriveAlternativeRemote('https://github.com/someone/some-repo/')).toBe(
      'git@github.com:someone/some-repo.git',
    )
    expect(deriveAlternativeRemote('  https://github.com/someone/some-repo.git  ')).toBe(
      'git@github.com:someone/some-repo.git',
    )
  })

  it('SSH 形式 → https 形式（已经带 .git 的不重复加）', () => {
    expect(deriveAlternativeRemote('git@github.com:someone/some-repo.git')).toBe(
      'https://github.com/someone/some-repo.git',
    )
    expect(deriveAlternativeRemote('git@github.com:someone/some-repo')).toBe(
      'https://github.com/someone/some-repo.git',
    )
  })

  it('http（不是 https）也认；github.com 的大小写不敏感', () => {
    expect(deriveAlternativeRemote('http://github.com/o/r.git')).toBe('git@github.com:o/r.git')
    expect(deriveAlternativeRemote('HTTPS://GitHub.com/o/r.git')).toBe('git@github.com:o/r.git')
  })

  it('非 github 一律 null —— 猜错主机比不换路坏得多', () => {
    expect(deriveAlternativeRemote('https://gitlab.com/o/r.git')).toBeNull()
    expect(deriveAlternativeRemote('https://gitee.com/o/r.git')).toBeNull()
    expect(deriveAlternativeRemote('git@gitlab.com:o/r.git')).toBeNull()
    expect(deriveAlternativeRemote('D:/repos/local-thing')).toBeNull()
    expect(deriveAlternativeRemote('git://github.com/o/r.git')).toBeNull()
    expect(deriveAlternativeRemote('ssh://git@github.com/o/r.git')).toBeNull()
  })

  it('认不出 owner/repo 时 null（包括 github.com 的网页地址）', () => {
    expect(deriveAlternativeRemote('https://github.com/someone')).toBeNull()
    expect(deriveAlternativeRemote('https://github.com')).toBeNull()
    expect(deriveAlternativeRemote('https://github.com/')).toBeNull()
    expect(deriveAlternativeRemote('git@github.com:someone')).toBeNull()
    // 网页地址不是 remote：只取前两段会猜错，索性不猜
    expect(deriveAlternativeRemote('https://github.com/someone/some-repo/tree/main')).toBeNull()
    expect(deriveAlternativeRemote('https://github.com/someone/some-repo/issues')).toBeNull()
  })

  it('空串 → null', () => {
    expect(deriveAlternativeRemote('')).toBeNull()
    expect(deriveAlternativeRemote('   ')).toBeNull()
  })
})

describe('fallbackTimeoutMs', () => {
  it('换路那一次比主路径短，且有上限', () => {
    expect(fallbackTimeoutMs(120_000)).toBeLessThan(120_000)
    expect(fallbackTimeoutMs(120_000)).toBeLessThanOrEqual(15_000)
  })

  it('调用方没给超时也一样算，不能因为省了参数就把最坏情况翻倍', () => {
    expect(fallbackTimeoutMs(undefined)).toBe(15_000)
  })

  it('主路径本来就很短时不至于短到一上手就掐', () => {
    expect(fallbackTimeoutMs(5_000)).toBeGreaterThanOrEqual(3_000)
  })
})

/**
 * 「这条是 HTTPS，若你配了 SSH key，可以用 SSH 再试」——这是 **auth 不做隐式重试**
 * 的补偿：不替他多等一次，但把另一条路说出来。做成纯函数才好直接钉住文案，
 * 否则只能去网上找一台真的会要认证、且本机必然失败的私有仓库。
 */
describe('withOtherRouteHint', () => {
  const auth = {
    kind: 'auth' as const,
    message: '需要认证。私有仓库请先在终端里认证（推荐 gh auth login）',
  }

  it('认证失败 + HTTPS → 建议 SSH，并给出可直接复制的地址', () => {
    const hinted = withOtherRouteHint(
      auth,
      'https',
      'git@github.com:o/r.git',
      1,
    )
    expect(hinted.message).toContain('SSH')
    expect(hinted.message).toContain('git@github.com:o/r.git')
    // 归因不变：换不换路是另一层，别把 auth 说成网络问题
    expect(hinted.kind).toBe('auth')
  })

  it('认证失败 + SSH → 建议 HTTPS', () => {
    const hinted = withOtherRouteHint(auth, 'ssh', 'https://github.com/o/r.git', 1)
    expect(hinted.message).toContain('HTTPS')
    expect(hinted.message).toContain('https://github.com/o/r.git')
  })

  it('已经自动试过两次的话，把这件事说清楚（别让用户再白试一遍）', () => {
    const hinted = withOtherRouteHint(auth, 'https', 'git@github.com:o/r.git', 2)
    expect(hinted.message).toContain('已经自动试过另一条路')
  })

  it('网络失败不加建议：那条路本来就已经自动试过了', () => {
    const network = { kind: 'network' as const, message: '连不上远程。检查网络、代理或 DNS' }
    expect(withOtherRouteHint(network, 'https', 'git@github.com:o/r.git', 1)).toBe(network)
  })

  it('没有另一条路时不说空话', () => {
    expect(withOtherRouteHint(auth, 'https', null, 1)).toBe(auth)
  })
})

/**
 * 两条路都失败时的归因。记住的 preferred 一旦过时（换网络、那条路临时抽风），
 * 先试的失败者就会被当成「主路径」——只报它，用户会去修错的方向。
 */
describe('composeFetchFailure', () => {
  it('两条路归因不同 → 逐条点名「哪条路出了什么」', () => {
    const composed = composeFetchFailure([
      {
        transport: 'ssh',
        url: 'git@github.com:o/r.git',
        code: 128,
        timedOut: false,
        error: { kind: 'auth', message: '需要认证' },
      },
      {
        transport: 'https',
        url: 'https://github.com/o/r.git',
        code: 128,
        timedOut: false,
        error: { kind: 'network', message: '连不上远程。检查网络、代理或 DNS' },
      },
    ])

    expect(composed.message).toContain('SSH：需要认证')
    expect(composed.message).toContain('HTTPS：连不上远程')
  })

  it('两条路归因相同、文案也相同 → 只报一条（同一句话写两遍是噪音）', () => {
    const composed = composeFetchFailure([
      {
        transport: 'https',
        url: 'https://github.com/o/r.git',
        code: 128,
        timedOut: false,
        error: { kind: 'network', message: '连不上远程。检查网络、代理或 DNS' },
      },
      {
        transport: 'ssh',
        url: 'git@github.com:o/r.git',
        code: 128,
        timedOut: false,
        error: { kind: 'network', message: '连不上远程。检查网络、代理或 DNS' },
      },
    ])
    expect(composed.message).toBe('连不上远程。检查网络、代理或 DNS')
  })

  /*
    去重的判据是**文案**不是归因种类。两条路都报 network、但 stderr 首行不同时
    （HTTP 超时 vs SSH 连不上），第二条带着真信息，丢掉它等于把「两条都试过」这件事
    说成了「一条」。这一条是这个函数的边界，不能只按 kind 去重。
  */
  it('归因相同但文案不同 → 两条都要留下', () => {
    const composed = composeFetchFailure([
      {
        transport: 'https',
        url: 'https://github.com/o/r.git',
        code: 124,
        timedOut: true,
        error: { kind: 'network', message: 'HTTPS 连不上：连接超时' },
      },
      {
        transport: 'ssh',
        url: 'git@github.com:o/r.git',
        code: 128,
        timedOut: false,
        error: { kind: 'network', message: 'SSH 连不上：Connection refused' },
      },
    ])
    expect(composed.kind).toBe('network')
    expect(composed.message).toContain('HTTPS：HTTPS 连不上：连接超时')
    expect(composed.message).toContain('SSH：SSH 连不上：Connection refused')
  })

  it('一次都没失败（不该被调用）时给一条说得清的兜底', () => {
    const composed = composeFetchFailure([
      { transport: 'https', url: 'https://github.com/o/r.git', code: 0, timedOut: false },
    ])
    expect(composed.kind).toBe('unknown')
    expect(composed.message).toContain('fetch')
  })
})

describe('fetchRemote：取远程事实要更新 refs/remotes/origin/*', () => {
  it('显式 URL + 显式 refspec 会把 origin/main 真的拉新（不是只写 FETCH_HEAD）', async () => {
    const { origin, clone } = track(initClone(0))
    const stale = read(clone, 'rev-parse', 'origin/main')
    commit(origin, '远程往前走一格')

    const result = await fetchRemote({ dir: clone, url: origin, transport: 'ssh' })

    expect(result.ok).toBe(true)
    /*
      这一条是「调用规则」的验收点：只给 URL 的 `git fetch <url>` 只更新 FETCH_HEAD，
      `origin/main` 会原地不动 —— 分析就会把旧 refs 当成远程事实，
      把「已是最新」写成结论。所以不只看退出码 0，要看 ref 真的前进了。
    */
    expect(read(clone, 'rev-parse', 'origin/main')).not.toBe(stale)
    expect(read(clone, 'rev-parse', 'origin/main')).toBe(read(origin, 'rev-parse', 'main'))
  })

  it('--prune 照旧：远程删掉的分支，本地远程跟踪引用也要消失', async () => {
    const { origin, clone } = track(initClone(0))
    git(origin, 'checkout', '-q', '-b', 'gone')
    commit(origin, '只在 gone 上')
    git(origin, 'checkout', '-q', 'main')
    await fetchRemote({ dir: clone, url: origin, transport: 'ssh' })
    // 顺带钉住「命令怎么拼」：--prune 与显式 refspec 一条都不能少
    for (const entry of recentCommands().filter((e) => e.args[0] === 'fetch')) {
      expect(entry.args).toContain('--prune')
      expect(entry.args).toContain(FETCH_REFSPEC)
    }

    // 先证明「它在」：这里引用存在，正常取到的 stdout 就是那个 SHA
    expect(tryGit(clone, 'rev-parse', '--verify', '-q', 'origin/gone').code).toBe(0)
    expect(remoteBranchRefs(clone)).toContain('refs/remotes/origin/gone')

    git(origin, 'branch', '-D', 'gone')
    await fetchRemote({ dir: clone, url: origin, transport: 'ssh' })

    /*
      判「引用没了」**只能用不抛的辅助**：`rev-parse --verify` 在引用不存在时
      退出码 1、stdout 空，而 `git()` 辅助遇到非零退出直接抛——用它断言「不存在」
      等于把「抛异常」当成失败（第一版就是这样红的）。两条断言一起看：
      退出码说明 rev-parse 认不出来了，for-each-ref 说明 ref 真的从 refs 里没了。
    */
    expect(tryGit(clone, 'rev-parse', '--verify', '-q', 'origin/gone').code).toBe(1)
    expect(remoteBranchRefs(clone)).not.toContain('refs/remotes/origin/gone')
  })

  it('不动工作区、不改动仓库配置', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    const head = read(clone, 'rev-parse', 'HEAD')
    const remotes = read(clone, 'remote', '-v')
    fs.writeFileSync(path.join(clone, 'file.txt'), '本地未提交的改动\n', 'utf8')

    const result = await fetchRemote({ dir: clone, url: origin, transport: 'ssh' })

    expect(result.ok).toBe(true)
    expect(read(clone, 'rev-parse', 'HEAD')).toBe(head)
    expect(fs.readFileSync(path.join(clone, 'file.txt'), 'utf-8')).toBe('本地未提交的改动\n')
    // 不 `git remote set-url`、不碰 .git/config
    expect(read(clone, 'remote', '-v')).toBe(remotes)
  })
})

/**
 * 换路逻辑的**确定性**验收。
 *
 * 这些用例**不碰网络**（`fakeExecutor`），因为换路的判据是网络事实，而真网络会让
 * 「哪条通」变成环境依赖（实测那台机器 github:443 不通 / SSH 通，于是第一版
 * 「两条都失败」的用例根本不成立，还白等了 23.7 秒）。
 *
 * 假执行器只替换「怎么去跑」：`deriveAlternativeRemote`、超时分档、`preferred`
 * 的取舍、`attempts` / `onResolved` 全是真代码。命令怎么拼、refs 有没有真的前进
 * 由上面 `fetchRemote` 的真 git 用例负责——那两条**不能**假。
 */
describe('fetchWithFallback：按项目自动换传输方式', () => {
  it('主路径连不上 → 换另一条再试一次，两次都失败时两条路都报出来', async () => {
    const dir = track(initRepo())
    const url = 'https://github.com/o/r.git'
    git(dir, 'remote', 'add', 'origin', url)
    const fake = fakeExecutor('all')

    const result = await fetchWithFallback({
      dir,
      url,
      label: 'check',
      timeoutMs: 120_000,
      execute: fake.execute,
    })

    expect(result.ok).toBe(false)
    expect(result.transport).toBeNull()
    // ① 真的换过路，且顺序是「先 origin 那条，再另一条」
    expect(result.attempts.map((a) => a.transport)).toEqual(['https', 'ssh'])
    expect(result.attempts[1]?.url).toBe('git@github.com:o/r.git')
    expect(fake.calls.map((c) => c.url)).toEqual([url, 'git@github.com:o/r.git'])
    // ② 归因走的是真归因链路
    expect(result.error?.kind).toBe('network')
    // 两条路的文案不同（真实 stderr 带头），所以两条都要点名；
    // 只有两条回**同一句**话时才只报一条（单独在 composeFetchFailure 那组里钉着）
    expect(result.error?.message).toContain('HTTPS：')
    expect(result.error?.message).toContain('SSH：')
    // ③ 换路那一次**超时更短**（21 秒的连接超时不能再来一次）
    expect(fake.calls[0]?.timeoutMs).toBe(120_000)
    expect(fake.calls[1]?.timeoutMs).toBe(15_000)
    expect(fake.calls[1]?.timeoutMs).toBeLessThan(fake.calls[0]?.timeoutMs ?? 0)
    // ④ 没有走真 git（所以这里不该有任何子进程/命令日志）
    expect(gitSpawnCount()).toBe(0)
    expect(recentCommands().filter((e) => e.args[0] === 'fetch')).toHaveLength(0)
  })

  it('换路成功：上报的是**另一条**，且不会再回头试失败的那条', async () => {
    const dir = track(initRepo())
    const url = 'https://github.com/o/r.git'
    git(dir, 'remote', 'add', 'origin', url)
    // 只有 HTTPS 失败 —— 这正是用户那台机器的形态（443 不通、SSH 通）
    const fake = fakeExecutor(new Set([url]))
    const resolved: string[] = []

    const result = await fetchWithFallback({
      dir,
      url,
      label: 'check',
      execute: fake.execute,
      onResolved: (t) => resolved.push(t),
    })

    expect(result.ok).toBe(true)
    expect(result.transport).toBe('ssh')
    expect(fake.calls.map((c) => c.transport)).toEqual(['https', 'ssh'])
    // 上报的必须是**走通的那条**（server 拿它落库，下次先试它）
    expect(resolved).toEqual(['ssh'])
  })

  it('非 github 地址没有另一条路：只试一次，不瞎换', async () => {
    const dir = track(initRepo())
    const url = 'https://no-such-host.invalid/x.git'
    git(dir, 'remote', 'add', 'origin', url)
    const fake = fakeExecutor('all')

    const result = await fetchWithFallback({ dir, url, label: 'check', execute: fake.execute })

    expect(result.ok).toBe(false)
    expect(result.attempts).toHaveLength(1)
    expect(fake.calls).toHaveLength(1)
    expect(result.error?.kind).toBe('network')
    // 归因只有一条，不该硬凑出「两条路」的文案
    expect(result.error?.message).not.toContain('SSH：')
  })

  it('auth 不做隐式重试：只试记住的那一条，另一条只出现在文案里', async () => {
    const dir = track(initRepo())
    const url = 'https://github.com/o/r.git'
    git(dir, 'remote', 'add', 'origin', url)
    const calls: FetchRemoteOptions[] = []
    const execute = async (options: FetchRemoteOptions): Promise<FetchRemoteResult> => {
      calls.push(options)
      return {
        ok: false,
        code: 128,
        stderr: 'fatal: could not read Username',
        timedOut: false,
        error: {
          kind: 'auth',
          message: '需要认证。私有仓库请先在终端里认证（推荐 gh auth login）',
        },
      }
    }

    const result = await fetchWithFallback({ dir, url, label: 'check', execute })

    // auth 是「这条路走不通」而不是「连不上」：自动换路只会让用户多等一次
    expect(calls).toHaveLength(1)
    expect(result.attempts).toHaveLength(1)
    expect(result.error?.kind).toBe('auth')
    // 但要把他能做的事说出来
    expect(result.error?.message).toContain('SSH')
    expect(result.error?.message).toContain('git@github.com:o/r.git')
  })

  it('记住的那条路先试：preferred=ssh 时第一次就去 ssh 那条', async () => {
    const dir = track(initRepo())
    const url = 'https://github.com/o/r.git'
    git(dir, 'remote', 'add', 'origin', url)
    const fake = fakeExecutor('all')

    const result = await fetchWithFallback({
      dir,
      url,
      preferred: 'ssh',
      label: 'check',
      timeoutMs: 120_000,
      execute: fake.execute,
    })

    // 第一次就必须是 ssh —— 这是「记住结论」的全部意义（别每次先踩一遍 21 秒）
    expect(fake.calls[0]?.transport).toBe('ssh')
    expect(fake.calls[0]?.url).toBe('git@github.com:o/r.git')
    expect(result.attempts[0]?.transport).toBe('ssh')
    // 走的是记住的那条时，它已经算「第二条路」：给换路那一档的超时
    expect(fake.calls[0]?.timeoutMs).toBe(15_000)

    // 反过来也一样：preferred=https 时先试 origin 自己的地址
    const other = fakeExecutor('all')
    await fetchWithFallback({ dir, url, preferred: 'https', label: 'check', execute: other.execute })
    expect(other.calls[0]?.transport).toBe('https')
    expect(other.calls[0]?.url).toBe(url)
  })

  it('非 github 地址上的 preferred 不生效（没有另一条路可换，也不猜）', async () => {
    const dir = track(initRepo())
    const url = 'https://no-such-host.invalid/x.git'
    git(dir, 'remote', 'add', 'origin', url)
    const fake = fakeExecutor('all')

    const result = await fetchWithFallback({
      dir,
      url,
      preferred: 'ssh',
      label: 'check',
      execute: fake.execute,
    })

    /*
      这一条**故意**与上一条相反，因为它是规格里那条边界：另一条路只能从
      规范 GitHub 地址推出来。非 github 地址上 `deriveAlternativeRemote` 是 null，
      于是「记住的 ssh」没有对应地址可去——只能按地址本身的形式试（https）。
      第一版把它和上一条混在一起、还用了非 github 地址，才误判成「preferred 失效」。
    */
    expect(result.attempts).toHaveLength(1)
    expect(fake.calls[0]?.transport).toBe('https')
    expect(fake.calls[0]?.url).toBe(url)
  })

  it('走通之后上报「哪条路通了」，并且远程跟踪引用真的前进了', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    const resolved: string[] = []

    // 这一条用**真 git**：没有记住任何东西时按地址形式先试（本地路径 → ssh 这一支）
    const result = await fetchWithFallback({
      dir: clone,
      url: origin,
      onResolved: (t) => resolved.push(t),
    })

    expect(result.ok).toBe(true)
    expect(result.transport).toBe('ssh')
    expect(result.attempts).toHaveLength(1)
    expect(resolved).toEqual(['ssh'])
    expect(read(clone, 'rev-parse', 'origin/main')).toBe(read(origin, 'rev-parse', 'main'))
  })

  it('preferred 与地址同路时不换 URL（原样用它）', async () => {
    const { origin, clone } = track(initClone(0))
    commit(origin, '远程提交')
    const result = await fetchWithFallback({ dir: clone, url: origin, preferred: 'ssh' })
    expect(result.ok).toBe(true)
    expect(result.attempts[0]?.url).toBe(origin)
  })
})
