import { describe, expect, it } from 'vitest'
import type { RepoStatus, UpdateRecommendation, UpdateStatus } from '@git-nest/core'
import {
  STALE_AFTER_MS,
  VERDICT_TONE,
  freshnessOf,
  reasonFor,
  statusTitle,
  textFor,
  toneFor,
  worktreeNote,
} from './text'

/**
 * 状态域的文字与色彩政策。
 *
 * 这一族是全仓库最要紧那条原则（**不许说出没有依据的肯定**）在界面上的落点，
 * 而在这次拆分之前它一行测试都没有——只由「看着对」守着。
 *
 * 这里钉住三件容易悄悄坏掉的事：
 * 1. 限定语**什么时候必须出现**（以及它加在哪儿：加在真实状态上，不是替换它）；
 * 2. 色彩**什么时候降级**（陈旧的远程结论变灰，本地事实不降）；
 * 3. **绿色的边界**（六个判决里只有一个能绿）。
 */

const NOW = Date.parse('2026-10-05T12:00:00.000Z')

/** 造一个「与远程一致、刚查过」的仓库，再按需覆盖字段 */
function repo(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    path: 'D:/repos/x',
    checkedAt: new Date(NOW).toISOString(),
    isRepo: true,
    branch: 'main',
    detached: false,
    dirty: false,
    dirtyCount: 0,
    dirtyTracked: 0,
    dirtyUntracked: 0,
    upstream: 'origin/main',
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    remoteUrl: 'https://example.invalid/x.git',
    lastCommit: null,
    recommendation: null,
    status: 'up_to_date',
    error: null,
    ...overrides,
  }
}

/** 不依赖联网的那些状态：任何时候都该直说 */
const LOCAL_ONLY: UpdateStatus[] = [
  'dirty',
  'detached',
  'missing',
  'not_a_repo',
  'no_commits',
  'no_remote',
  'no_upstream',
  'gone',
  'error',
]

/** 拿远程做比较的那四个 */
const REMOTE_FACTS: UpdateStatus[] = ['up_to_date', 'behind', 'ahead', 'diverged']

describe('freshnessOf · 「多久算旧」只有一条线', () => {
  it('没查过 → never（不是 fresh）', () => {
    expect(freshnessOf({ checkedAt: null, now: NOW })).toBe('never')
  })

  it('时间读不出来也当没查过，不当新鲜', () => {
    expect(freshnessOf({ checkedAt: '不是时间', now: NOW })).toBe('never')
  })

  it('刚好 12 小时还算新鲜，超过 1 毫秒就旧了', () => {
    expect(freshnessOf({ checkedAt: new Date(NOW - STALE_AFTER_MS).toISOString(), now: NOW })).toBe('fresh')
    expect(
      freshnessOf({ checkedAt: new Date(NOW - STALE_AFTER_MS - 1).toISOString(), now: NOW }),
    ).toBe('stale')
  })
})

describe('textFor · 限定语加在真实状态上，不是替换它', () => {
  it('没联网确认时：方向与数字照给，只标注来源', () => {
    expect(textFor('behind', 'never')).toBe('落后远程（本地看到的，没联网确认）')
    expect(textFor('ahead', 'never')).toBe('领先远程（本地看到的，没联网确认）')
    expect(textFor('diverged', 'never')).toBe('已分叉（本地看到的，没联网确认）')
  })

  it('没查过远程时**不许说「已是最新」**——那是没有依据的肯定', () => {
    expect(textFor('up_to_date', 'never')).toBe('没查过远程')
  })

  it('陈旧时只有 up_to_date 降级措辞；方向类不降（方向来自本地 refs，可靠）', () => {
    expect(textFor('up_to_date', 'stale')).toBe('上次看是最新')
    expect(textFor('behind', 'stale')).toBe('落后远程')
    expect(textFor('ahead', 'stale')).toBe('领先远程')
    expect(textFor('diverged', 'stale')).toBe('已分叉')
  })

  it('刚查过时就是原话，一个限定语都不加', () => {
    expect(textFor('up_to_date', 'fresh')).toBe('已是最新')
    expect(textFor('behind', 'fresh')).toBe('落后远程')
  })

  it('纯本地事实三种新鲜度下说法完全一样（它们不依赖联网）', () => {
    for (const s of LOCAL_ONLY) {
      expect([textFor(s, 'never'), textFor(s, 'stale'), textFor(s, 'fresh')]).toEqual([
        textFor(s, 'fresh'),
        textFor(s, 'fresh'),
        textFor(s, 'fresh'),
      ])
    }
    expect(textFor('dirty', 'never')).toBe('有未提交改动')
    expect(textFor('missing', 'never')).toBe('目录不在了')
  })
})

describe('toneFor · 陈旧的远程结论降级成灰，本地事实不降', () => {
  it('刚查过：绿只给 up_to_date', () => {
    expect(toneFor('up_to_date', 'fresh')).toBe('text-signal-ok')
  })

  it('没查过或陈旧：四个远程结论一律变灰', () => {
    for (const s of REMOTE_FACTS) {
      expect(toneFor(s, 'never')).toBe('text-ink-3')
      expect(toneFor(s, 'stale')).toBe('text-ink-3')
    }
  })

  it('本地事实的颜色不受新鲜度影响（降级只针对「拿远程做的比较」）', () => {
    expect(toneFor('dirty', 'never')).toBe('text-signal-ahead')
    expect(toneFor('error', 'never')).toBe('text-signal-bad')
  })
})

describe('statusTitle · 缺省参数退到最保守的说法', () => {
  it('不传 freshness 时按「从没查过」说，而不是替调用方断言刚查过', () => {
    expect(statusTitle(repo({ status: 'behind', behind: 3 }))).toContain('没联网确认')
  })

  it('刚查过时说清数字的来源，而不是把上面那行结论重复一遍', () => {
    const t = statusTitle(repo({ status: 'behind', behind: 3 }), { checkedAt: new Date(NOW).toISOString(), now: NOW })
    expect(t).toContain('落后远程 3 个提交')
    expect(t).toContain('来自上次检查 fetch 到的远程跟踪分支')
  })

  it('陈旧时说清它来自上一次 fetch，之后没再查过', () => {
    const t = statusTitle(repo({ status: 'behind', behind: 3 }), {
      checkedAt: new Date(NOW - STALE_AFTER_MS - 1).toISOString(),
      now: NOW,
    })
    expect(t).toContain('之后没再查过')
  })

  it('没有远程跟踪分支可比时，不许报数字', () => {
    const t = statusTitle(repo({ status: 'behind', behind: 3, upstream: null }))
    expect(t).toContain('本地还没有远程跟踪分支可比')
  })

  it('不是仓库时原样用它自己的说法（不套远程那套限定语）', () => {
    const t = statusTitle(repo({ status: 'missing', error: { kind: 'missing', message: '目录不在了' } }))
    expect(t).toBe('目录不在了')
  })
})

describe('VERDICT_TONE · 绿色只给 safe', () => {
  it('六个判决里只有一个绿', () => {
    const green = Object.entries(VERDICT_TONE)
      .filter(([, cls]) => cls === 'text-signal-ok')
      .map(([verdict]) => verdict)
    expect(green).toEqual(['safe'])
  })

  it('「别拉」的两个是红的，其余不着色（中性灰）', () => {
    expect(VERDICT_TONE.rewritten).toBe('text-signal-bad')
    expect(VERDICT_TONE.unrelated).toBe('text-signal-bad')
    expect(VERDICT_TONE.gone).toBe('text-ink-3')
    expect(VERDICT_TONE.no_upstream).toBe('text-ink-3')
  })
})

/**
 * 卡片上那句理由：**只说上面没说过的事**。
 *
 * 两条规则都容易被"顺手改回去"：把「不用动」的理由加回来（同一句说两遍），或者
 * 把能快进的理由换回带数字的详细版（`↓22` 就在上面 40px）。所以这两条各自钉一条。
 */
describe('reasonFor · 理由只说上面没说过的事', () => {
  const rec = (over: Partial<UpdateRecommendation> = {}): UpdateRecommendation => ({
    verdict: 'safe',
    ahead: 0,
    behind: 0,
    canPull: false,
    reason: '',
    ...over,
  })

  it('没有判决就没有理由（那一行改由 provenance 承担）', () => {
    expect(reasonFor(null)).toBe('')
  })

  it('不用动：不写。状态词已经写着「已是最新」，理由再说一遍就是复制品', () => {
    expect(reasonFor(rec({ canPull: false, reason: '已是最新，没有要拉的。' }))).toBe('')
  })

  it('能快进：换 core 不带数字的那份——`↓22` 上面已经印着了', () => {
    const r = reasonFor(rec({ canPull: true, behind: 22, reason: '可以直接快进到远程的 22 个提交。' }))
    expect(r).toBe('可以直接快进。')
    expect(r).not.toMatch(/\d/)
  })

  it('本地领先：数字留着。它背后是「还没推」和「远程没新东西」，不是重复', () => {
    const reason = '本地有 3 个提交还没推，远程没有新东西可拉。'
    expect(reasonFor(rec({ canPull: false, ahead: 3, reason }))).toBe(reason)
  })

  it('分叉 / 被改写这类：原样照抄 core 的说法', () => {
    const reason = '上游和本地都往前走了，不能快进，需要你自己决定怎么合。'
    expect(reasonFor(rec({ verdict: 'diverged', ahead: 3, behind: 2, reason }))).toBe(reason)
  })
})

/**
 * 工作区那句话。
 *
 * 它替掉的是一句笼统的「有未提交的改动」——那句话把「你改了一半的代码」和
 * 「20 个没进 git 的构建产物」说成同一件事，于是工具栏着一堆与更新无关的东西
 * 不让人动（core 的 `describeWorktree()` 记着同一笔账）。所以这里钉的是**分类**：
 * 有已跟踪改动就往"会被拦下"那边说，只有未跟踪文件就明说是哪一类。
 */
describe('worktreeNote · 说清是哪一类改动', () => {
  it('干净时没有这一句', () => {
    expect(worktreeNote(repo())).toBeNull()
  })

  it('只有已跟踪文件被改：说的是「改过还没提交」，并点名会被拦下', () => {
    const note = worktreeNote(repo({ dirty: true, dirtyCount: 2, dirtyTracked: 2 }))
    expect(note?.text).toBe('2 个文件改过还没提交')
    expect(note?.text).not.toContain('未跟踪')
    expect(note?.title).toContain('会被拦下')
  })

  it('只有未跟踪文件：明说是这一类，不再说成「有改动」', () => {
    const note = worktreeNote(repo({ dirty: true, dirtyCount: 20, dirtyTracked: 0, dirtyUntracked: 20 }))
    expect(note?.text).toBe('只有 20 个未跟踪文件')
    expect(note?.title).toContain('构建产物')
  })

  it('两类都有：两个数字都在', () => {
    const note = worktreeNote(repo({ dirty: true, dirtyCount: 7, dirtyTracked: 2, dirtyUntracked: 5 }))
    expect(note?.text).toContain('2 个文件改过')
    expect(note?.text).toContain('5 个未跟踪')
  })

  it('数不出来时（lean 档不读工作区）退回笼统一句，不编 0', () => {
    const note = worktreeNote(repo({ dirty: true, dirtyCount: 0 }))
    expect(note?.text).toBe('有未提交的改动')
    expect(note?.text).not.toContain('0 个')
  })
})
