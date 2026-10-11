import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Diff } from './badges'

/**
 * 差异那一列在**没有依据**时的说法。
 *
 * 这是一个真实 bug 的回归。刷新页面时的次序是：
 * 1. 清单先到——它带着 `attention`，那是**库里上次检查**的结果；
 * 2. 逐仓库的 git 状态 1–2 秒后才到（服务端每个仓库跑一次 git）。
 *
 * 第 1 步到第 2 步之间，`ahead/behind` 是 `null`，而组件把它们当成 0 ——
 * 于是**每一行都先显示「一致」**，差异列更直接渲染出字面的 `↓0 ↑0`，
 * 1、2 秒后再跳成真的值。「一致」在这里是一个**没有任何依据的肯定**，
 * 正是这个软件最不该说的话。
 *
 * 修法是把「没有依据」的几种情况分开（见 `Comparability`）：**还没读到**、
 * **读不出来**、**读到了但没有上游**、**上游被删了**、**没有合格的远程检查**。
 * 它们都不许给结论——**而且说法要分开**：下一步动作完全不同（等 / 去看目录 /
 * 去配上游 / 去远端重建）。
 *
 * 这段说法原来住在 `SyncBadge`（「同步状态」那一列）。那一列按设计文档收掉了
 * （5 列：仓库 / 分支 / 状态 / 差异 / 上次检查），说法并到这里——**一条没丢**。
 */
describe('Diff · 没有依据时不许给数字，而且要说清是哪一种', () => {
  it('这一行的状态还没读回来：给「—」，不说「一致」', () => {
    const { container } = render(
      <Diff ahead={null} behind={null} hasCheck comparable="reading" />,
    )
    expect(container.textContent).not.toContain('↓')
    expect(container.textContent).not.toContain('↑')
    expect(container.textContent).toContain('—')
  })

  it('读不出来（目录不在了 / 不是仓库）：也是「—」', () => {
    const { container } = render(
      <Diff ahead={null} behind={null} hasCheck comparable="unreadable" />,
    )
    expect(container.textContent).toContain('—')
  })

  it('是仓库但没配上游：「没有上游」——不是「—」，两者下一步动作不同', () => {
    const { container } = render(
      <Diff ahead={null} behind={null} hasCheck comparable="no-upstream" />,
    )
    expect(container.textContent).toContain('没有上游')
  })

  it('上游被远程删了：「上游已关闭」，而且它优先于「没有上游」', () => {
    const { container } = render(
      <Diff ahead={null} behind={null} upstreamGone hasCheck comparable="no-upstream" />,
    )
    expect(container.textContent).toContain('上游已关闭')
    expect(container.textContent).not.toContain('没有上游')
  })

  it('服务端那边没有合格的远程检查：「未知」', () => {
    const { container } = render(
      <Diff ahead={null} behind={null} hasCheck={false} comparable="ready" />,
    )
    expect(container.textContent).toContain('未知')
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
