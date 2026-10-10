import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Diff, SyncBadge } from './badges'

/**
 * 清单那两列在**状态还没读回来**时的表现。
 *
 * 这是一个真实 bug 的回归。刷新页面时的次序是：
 * 1. 清单先到——它带着 `attention`，那是**库里上次检查**的结果；
 * 2. 逐仓库的 git 状态 1–2 秒后才到（服务端每个仓库跑一次 git）。
 *
 * 第 1 步到第 2 步之间，`SyncBadge` 拿到的 `ahead/behind` 是 `null`，而它把
 * `null` 当成 0 —— 于是**每一行都先显示「一致」**，1、2 秒后再跳成真的值。
 * 「一致」在这里是一个**没有任何依据的肯定**，正是这个软件最不该说的话。
 *
 * 修法不是「藏起来不显示」，而是把两件不同的事分开：
 * **「还没读到」**（`hasStatus=false`）与**「读到了，值就是 0」**。
 * 前者一律给 `—`。
 *
 * 与 `hasCheck` 的分工：`hasCheck` 说的是「服务端那边有合格的远程检查结论」，
 * `hasStatus` 说的是「本地 git 状态读回来了」。两个都是「有没有依据」，
 * 但依据来自不同的地方，缺哪一个都不能下结论。
 */
describe('SyncBadge · 状态还没读回来时不许给结论', () => {
  it('还没读到：不能说「一致」', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone={false} hasCheck hasStatus={false} />,
    )
    expect(screen.queryByText('一致')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('还没读到：「上游已关闭」这种结论同样不能说（那是 status 里的事实）', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone hasCheck hasStatus={false} />,
    )
    expect(screen.queryByText('上游已关闭')).toBeNull()
  })

  it('读到了、两个数字都是 0：这才是「一致」', () => {
    render(<SyncBadge ahead={0} behind={0} upstreamGone={false} hasCheck hasStatus />)
    expect(screen.getByText('一致')).toBeTruthy()
  })

  it.each([
    [0, 2, '远程领先'],
    [1, 0, '本地领先'],
    [1, 2, '已分叉'],
  ])('读到了：ahead=%i behind=%i → %s', (ahead, behind, expected) => {
    render(<SyncBadge ahead={ahead} behind={behind} upstreamGone={false} hasCheck hasStatus />)
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('读到了、上游被删 → 上游已关闭', () => {
    render(<SyncBadge ahead={0} behind={0} upstreamGone hasCheck hasStatus />)
    expect(screen.getByText('上游已关闭')).toBeTruthy()
  })

  it('没有合格的远程检查 → 未知（这是「我们知道我们不知道」，不是还没读）', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone={false} hasCheck={false} hasStatus />,
    )
    expect(screen.getByText('未知')).toBeTruthy()
  })
})

describe('Diff · 没有依据就不给数字', () => {
  it('还没读到：不许给 ↓0 ↑0（那是编出来的，不是查到的）', () => {
    const { container } = render(<Diff ahead={null} behind={null} hasCheck hasStatus={false} />)
    expect(container.textContent).not.toContain('↓')
    expect(container.textContent).not.toContain('↑')
    expect(container.textContent).toContain('—')
  })

  it('没有合格的远程检查：同上', () => {
    const { container } = render(<Diff ahead={null} behind={null} hasCheck={false} hasStatus />)
    expect(container.textContent).toContain('—')
  })

  it('读到了、都是 0：这时给 ↓0 ↑0 是对的（我们确实查到了 0）', () => {
    const { container } = render(<Diff ahead={0} behind={0} hasCheck hasStatus />)
    expect(container.textContent).toContain('↓0')
    expect(container.textContent).toContain('↑0')
  })

  it('读到了：两个方向都给', () => {
    const { container } = render(<Diff ahead={1} behind={3} hasCheck hasStatus />)
    expect(container.textContent).toContain('↓3')
    expect(container.textContent).toContain('↑1')
  })
})
