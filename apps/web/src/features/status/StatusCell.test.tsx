import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  STALE_AFTER_MS,
  Delta,
  freshnessOf,
  textFor,
  toneFor,
  type FreshnessState,
} from './StatusCell'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

describe('freshnessOf', () => {
  it('没查过就是 never', () => {
    expect(freshnessOf({ checkedAt: null, now: NOW })).toBe('never')
  })

  it('坏时间当作没查过', () => {
    expect(freshnessOf({ checkedAt: '不是时间', now: NOW })).toBe('never')
  })

  it('刚查过是 fresh，超过阈值就是 stale', () => {
    expect(freshnessOf({ checkedAt: hoursAgo(1), now: NOW })).toBe('fresh')
    expect(freshnessOf({ checkedAt: hoursAgo(STALE_AFTER_MS / 3_600_000 - 1), now: NOW })).toBe('fresh')
    expect(freshnessOf({ checkedAt: hoursAgo(48), now: NOW })).toBe('stale')
  })
})

describe('措辞与颜色：远程相关的结论必须看新鲜度', () => {
  const cases: { status: Parameters<typeof textFor>[0]; label: string }[] = [
    { status: 'up_to_date', label: '已是最新' },
    { status: 'behind', label: '落后远程' },
    { status: 'ahead', label: '领先远程' },
    { status: 'diverged', label: '已分叉' },
  ]

  it('从没查过远程：不说「已是最新」，但也不能把方向丢掉', () => {
    // up_to_date 没有依据，只能退成「没查过远程」
    expect(textFor('up_to_date', 'never')).toBe('没查过远程')

    // 但 behind / ahead / diverged 的**方向和数字是本地 refs 的事实**，
    // 该显示出来，只在后面标注「没联网确认」。
    // 以前这里一律返回「没查过远程」，导致同一个面板上
    // 提示行说「落后远程 2411 个提交」而状态格说「没查过远程」，自相矛盾。
    expect(textFor('behind', 'never')).toContain('落后远程')
    expect(textFor('ahead', 'never')).toContain('领先远程')
    expect(textFor('diverged', 'never')).toContain('已分叉')
    for (const s of ['behind', 'ahead', 'diverged'] as const) {
      expect(textFor(s, 'never')).toContain('没联网确认')
    }
  })

  it('查过但很旧：「已是最新」降级成「上次看是最新」', () => {
    expect(textFor('up_to_date', 'stale')).toBe('上次看是最新')
    // behind / ahead 的数字仍然有用，只是语气收一收
    expect(textFor('behind', 'stale')).toBe('落后远程')
  })

  it('新鲜时才用肯定的语气', () => {
    for (const c of cases) {
      expect(textFor(c.status, 'fresh')).toBe(c.label)
    }
  })

  it('陈旧 / 没查过：不给绿色', () => {
    expect(toneFor('up_to_date', 'fresh')).toBe('text-signal-ok')
    const muted: FreshnessState[] = ['stale', 'never']
    for (const f of muted) {
      for (const c of cases) {
        expect(toneFor(c.status, f)).toBe('text-ink-3')
      }
    }
  })

  it('纯本地状态不受新鲜度影响：随时都可信', () => {
    const local: Parameters<typeof textFor>[0][] = [
      'dirty',
      'detached',
      'no_remote',
      'no_upstream',
      'no_commits',
      'missing',
      'not_a_repo',
    ]
    for (const s of local) {
      expect(textFor(s, 'never')).toBe(textFor(s, 'fresh'))
      expect(textFor(s, 'stale')).toBe(textFor(s, 'fresh'))
      expect(toneFor(s, 'never')).toBe(toneFor(s, 'fresh'))
    }
  })
})

/**
 * `Delta` 是列表页状态列与更新面板结果行**共用**的那一份
 * （原来 UpdatePanel 里另写了一份，容易只改一处）。这里钉住它的文案，
 * 免得两处又飘开。
 */
describe('Delta', () => {
  it('领先：↑ + 数字 + 可读的 title', () => {
    render(<Delta n={3} dir="ahead" />)
    expect(screen.getByText('↑3')).toBeTruthy()
    expect(screen.getByTitle('领先 3 个提交')).toBeTruthy()
  })

  it('落后：↓ + 数字 + 可读的 title', () => {
    render(<Delta n={2411} dir="behind" />)
    expect(screen.getByText('↓2411')).toBeTruthy()
    expect(screen.getByTitle('落后 2411 个提交')).toBeTruthy()
  })
})
