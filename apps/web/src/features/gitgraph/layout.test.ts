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

  it('分叉：子提交另开 lane，父提交回到 lane 0', () => {
    // 新 → 旧：merge 在最上面
    const layout = layoutGraph([
      entry('m', ['main2', 'side1'], 'merge'),
      entry('main2', ['base'], '主干'),
      entry('side1', ['base'], '支线'),
      entry('base', [], '起点'),
    ])

    const laneOf = (hash: string) => layout.nodes.find((n) => n.entry.hash === hash)?.lane
    expect(laneOf('m')).toBe(0)
    expect(laneOf('main2')).toBe(0)
    // 支线必须离开 lane 0
    expect(laneOf('side1')).toBe(1)
    // 两条线都要汇回 base
    expect(laneOf('base')).toBe(0)
    expect(layout.edges.filter((e) => e.toRow === 3)).toHaveLength(2)
    expect(layout.laneCount).toBeGreaterThanOrEqual(2)
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
