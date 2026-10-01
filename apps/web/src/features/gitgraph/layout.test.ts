import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@git-nest/core'
import { edgePath, layoutGraph } from './layout'

const entry = (
  hash: string,
  parents: string[] = [],
  subject = hash,
): GitLogEntry => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents,
  authorName: 'me',
  authorEmail: 'me@x',
  date: '2026-06-20T10:00:00+08:00',
  subject,
  refs: [],
})

describe('layoutGraph', () => {
  it('线性历史只用一条 lane', () => {
    const layout = layoutGraph([entry('c', ['b']), entry('b', ['a']), entry('a')])
    expect(layout.laneCount).toBe(1)
    expect(layout.nodes.map((n) => n.lane)).toEqual([0, 0, 0])
    expect(layout.edges).toHaveLength(2)
  })

  it('分叉：支线另开 lane，汇回父提交时回到主干', () => {
    // 新 → 旧：m 是 head，main2 与 side1 都从 base 分出来
    const layout = layoutGraph([
      entry('m', ['main2'], '主干'),
      entry('main2', ['base'], '主干'),
      entry('side1', ['base'], '支线'),
      entry('base', [], '起点'),
    ])

    const laneOf = (hash: string) => layout.nodes.find((n) => n.entry.hash === hash)?.lane
    expect(laneOf('m')).toBe(0)
    expect(laneOf('main2')).toBe(0)
    // 支线必须离开 lane 0
    expect(laneOf('side1')).toBe(1)
    // 两条线都要汇回 base，base 回到主干
    expect(laneOf('base')).toBe(0)
    expect(layout.edges.filter((e) => e.toRow === 3)).toHaveLength(2)
    expect(layout.laneCount).toBe(2)
  })

  it('merge 的两侧各自留在自己的列上', () => {
    const layout = layoutGraph([
      entry('m', ['main2', 'side1'], 'merge'),
      entry('main2', ['base'], '主干'),
      entry('side1', ['base'], '支线'),
      entry('base', [], '起点'),
    ])

    const laneOf = (hash: string) => layout.nodes.find((n) => n.entry.hash === hash)?.lane
    expect(laneOf('m')).toBe(0)
    expect(laneOf('main2')).toBe(0)
    expect(laneOf('side1')).toBe(1)
    // 两条线汇到同一个父提交
    expect(layout.edges.filter((e) => e.toRow === 3)).toHaveLength(2)
    expect(layout.laneCount).toBe(2)
  })

  it('merge 节点被标记出来', () => {
    const layout = layoutGraph([entry('m', ['a', 'b'], 'merge'), entry('a', ['r']), entry('b', ['r']), entry('r')])
    const merge = layout.nodes[0]
    expect(merge?.isMerge).toBe(true)
    expect(layout.nodes[1]?.isMerge).toBe(false)
  })

  it('空输入不炸', () => {
    const layout = layoutGraph([])
    expect(layout.nodes).toEqual([])
    expect(layout.laneCount).toBe(1)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('缺少父提交信息（浅克隆）也不会丢节点', () => {
    const layout = layoutGraph([entry('c', ['missing']), entry('b', ['c']), entry('a', ['b'])])
    expect(layout.nodes).toHaveLength(3)
  })
})

/**
 * 车道复用与画布尺寸。
 *
 * 真实仓库上实测到的 bug：车道会被**永久**泄漏。原实现只在 `!continues`
 * （root、或所有父提交都已分配过）时释放车道，而「基点不是 root 的 merge」
 * 会让被第二个父提交预定过的那条 lane 从此无人释放 —— `laneCount` 随历史里的
 * merge 数量单调膨胀。真实仓库 archify（120 个提交、19 个 merge）量到
 * laneCount=40，其中 8 条 lane 从未被任何节点或连线引用；
 * 再被 width 的硬上限一夹，75/120 个提交点被画到画布外看不见。
 *
 * 下面的用例用 `it.fails` **记录**这个已知缺陷：它现在是红的，所以构建不会因此
 * 中断，但也不会被忘记。修好之后 vitest 会反过来提醒把标记去掉。
 * 试过的三种改法都失败了（都退回原实现）：
 *   - 把 `active` 改成按待定 claim 引用计数：列顺序规律被破坏，线性历史排成 [0,1,0]
 *   - 自顶向下按「子提交的已定列」定向：同样排错
 *   - 兄弟列去重：仍然错
 * 结论：这个分配器需要按「按行区间分配列」重写（每条线占一个行区间，区间不重叠
 * 才能同列），而不是继续修那个增量 set。相关实验与最小复现见
 * docs/AUDIT-2026-10-01.md 的 6.4。
 */
describe('车道复用', () => {
  /** 链式堆叠 N 个菱形（merge 的基点不是 root，正是泄漏的触发形态）。 */
  function stackedDiamonds(n: number): GitLogEntry[] {
    const entries: GitLogEntry[] = []
    const ms = Array.from({ length: n }, (_, i) => `M${i}`)
    for (let i = 0; i < n; i++) {
      const topParents = i === 0 ? ['A0', 'B0'] : [`A${i}`, `B${i}`]
      entries.push(entry(ms[i]!, topParents))
      entries.push(entry(`A${i}`, [i === n - 1 ? 'R' : ms[i + 1]!]))
      entries.push(entry(`B${i}`, [i === n - 1 ? 'R' : ms[i + 1]!]))
    }
    entries.push(entry('R'))
    return entries
  }

  it.fails('重复的菱形不会把车道越撑越多（已知缺陷：车道泄漏）', () => {
    const layout = layoutGraph(stackedDiamonds(12))
    // 任意时刻真正并存的线只有两条，所以 lane 数必须是个小常数
    expect(layout.laneCount).toBeLessThanOrEqual(3)
  })

  it('laneCount 与「实际被引用到的最大 lane」一致（不留空转车道）', () => {
    for (const n of [1, 2, 5, 12]) {
      const layout = layoutGraph(stackedDiamonds(n))
      const maxLane = Math.max(
        0,
        ...layout.nodes.map((nd) => nd.lane),
        ...layout.edges.flatMap((e) => [e.fromLane, e.toLane]),
      )
      expect(layout.laneCount, `n=${n}`).toBe(maxLane + 1)
    }
  })
})

describe('画布宽度', () => {
  const wideEntries = (): GitLogEntry[] => [
    entry('m', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'], '章鱼合并'),
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((h) => entry(h, ['r'])),
    entry('r'),
  ]

  it('默认宽度必须装得下所有车道（不能把节点画到画布外）', () => {
    const layout = layoutGraph(wideEntries())
    const maxX = Math.max(
      ...layout.nodes.map((n) => layout.laneX(n.lane)),
      ...layout.edges.map((e) => layout.laneX(Math.max(e.fromLane, e.toLane))),
    )
    expect(layout.width).toBeGreaterThanOrEqual(maxX)
  })

  it('显式传 width 时按它封顶（调用方仍可覆盖）', () => {
    const layout = layoutGraph(wideEntries(), 500)
    expect(layout.width).toBeLessThanOrEqual(500)
  })
})

describe('edgePath', () => {
  const laneX = (l: number) => 16 + l * 15
  const rowY = (r: number) => r * 30 + 15

  it('同 lane 是一条直线', () => {
    const d = edgePath({ fromRow: 0, fromLane: 1, toRow: 1, toLane: 1 }, laneX, rowY)
    expect(d).toBe('M 31 15 V 45')
  })

  it('换 lane 时先竖后横再竖', () => {
    const d = edgePath({ fromRow: 0, fromLane: 0, toRow: 1, toLane: 2 }, laneX, rowY)
    expect(d).toBe('M 16 15 V 30 H 46 V 45')
  })
})
