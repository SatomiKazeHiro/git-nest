import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Diff, SyncBadge } from './badges'

/**
 * 清单那两列在**没有依据**时的表现。
 *
 * 这是一个真实 bug 的回归。刷新页面时的次序是：
 * 1. 清单先到——它带着 `attention`，那是**库里上次检查**的结果；
 * 2. 逐仓库的 git 状态 1–2 秒后才到（服务端每个仓库跑一次 git）。
 *
 * 第 1 步到第 2 步之间，`ahead/behind` 是 `null`，而组件把它们当成 0 ——
 * 于是**每一行都先显示「一致」**，`Diff` 更直接渲染出字面的 `↓0 ↑0`，
 * 1、2 秒后再跳成真的值。「一致」在这里是一个**没有任何依据的肯定**，
 * 正是这个软件最不该说的话。
 *
 * 修法是把「没有依据」的四种情况分开（见 `Comparability`）：
 * **还没读到**、**读不出来**、**读到了但没有上游**、**有上游**。
 * 前三种都不许给结论；只有第四种的数字才可信。
 *
 * 与 `hasCheck` 的分工：`hasCheck` 说的是「服务端那边有合格的远程检查结论」，
 * `comparable` 说的是「这一次读回来的状态里有没有可比的对象」。
 * 两个都是「有没有依据」，缺哪一个都不能下结论。
 */
describe('SyncBadge · 没有依据时不许给结论', () => {
  it('还没读到：不能说「一致」', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone={false} hasCheck comparable="reading" />,
    )
    expect(screen.queryByText('一致')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('还没读到：「上游已关闭」这种结论同样不能说（那是 status 里的事实）', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone hasCheck comparable="reading" />,
    )
    expect(screen.queryByText('上游已关闭')).toBeNull()
  })

  it('读不出来（目录不在了 / 不是仓库）：给「—」，不是「没有上游」', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone={false} hasCheck comparable="unreadable" />,
    )
    expect(screen.queryByText('一致')).toBeNull()
    expect(screen.queryByText('没有上游')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('读到了，但这个分支没有上游：说「没有上游」，不是「一致」', () => {
    // 现场：把上游取消配置之后，库里上次的结论还在（`hasCheck` 仍为真），
    // 而这一次读回来的 ahead/behind 都是 null。
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone={false} hasCheck comparable="no-upstream" />,
    )
    expect(screen.queryByText('一致')).toBeNull()
    expect(screen.getByText('没有上游')).toBeTruthy()
  })

  it('读到了、两个数字都是 0：这才是「一致」', () => {
    render(<SyncBadge ahead={0} behind={0} upstreamGone={false} hasCheck comparable="ready" />)
    expect(screen.getByText('一致')).toBeTruthy()
  })

  it.each([
    [0, 2, '远程领先'],
    [1, 0, '本地领先'],
    [1, 2, '已分叉'],
  ])('读到了：ahead=%i behind=%i → %s', (ahead, behind, expected) => {
    render(
      <SyncBadge ahead={ahead} behind={behind} upstreamGone={false} hasCheck comparable="ready" />,
    )
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('读到了、上游被删 → 上游已关闭', () => {
    render(<SyncBadge ahead={0} behind={0} upstreamGone hasCheck comparable="ready" />)
    expect(screen.getByText('上游已关闭')).toBeTruthy()
  })

  it('没有合格的远程检查 → 未知（这是「我们知道我们不知道」，不是还没读）', () => {
    render(
      <SyncBadge ahead={null} behind={null} upstreamGone={false} hasCheck={false} comparable="ready" />,
    )
    expect(screen.getByText('未知')).toBeTruthy()
  })
})

describe('Diff · 没有依据就不给数字', () => {
  it.each(['reading', 'unreadable', 'no-upstream'] as const)(
    '%s：不给 ↓0 ↑0（那是编出来的，不是查到的）',
    (comparable) => {
      const { container } = render(
        <Diff ahead={null} behind={null} hasCheck comparable={comparable} />,
      )
      expect(container.textContent).not.toContain('↓')
      expect(container.textContent).not.toContain('↑')
      expect(container.textContent).toContain('—')
    },
  )

  it('没有合格的远程检查：同上', () => {
    const { container } = render(
      <Diff ahead={null} behind={null} hasCheck={false} comparable="ready" />,
    )
    expect(container.textContent).toContain('—')
  })

  it('读到了、都是 0：这时给 ↓0 ↑0 是对的（我们确实查到了 0）', () => {
    const { container } = render(<Diff ahead={0} behind={0} hasCheck comparable="ready" />)
    expect(container.textContent).toContain('↓0')
    expect(container.textContent).toContain('↑0')
  })

  it('读到了：两个方向都给', () => {
    const { container } = render(<Diff ahead={1} behind={3} hasCheck comparable="ready" />)
    expect(container.textContent).toContain('↓3')
    expect(container.textContent).toContain('↑1')
  })
})
