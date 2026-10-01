import { describe, expect, it } from 'vitest'
import {
  STALE_AFTER_MS,
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

  it('从没查过远程：不说「已是最新」', () => {
    for (const c of cases) {
      expect(textFor(c.status, 'never')).not.toBe(c.label)
      expect(textFor(c.status, 'never')).toBe('没查过远程')
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
