import { useMemo } from 'react'
import type { GitLogEntry } from '@git-nest/core'

export const ROW_HEIGHT = 30
export const LANE_WIDTH = 15
const LEFT_PAD = 16

export interface GraphNode {
  entry: GitLogEntry
  row: number
  lane: number
  isMerge: boolean
}

export interface GraphEdge {
  fromRow: number
  fromLane: number
  toRow: number
  toLane: number
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  laneCount: number
  width: number
  height: number
  laneX: (lane: number) => number
  rowY: (row: number) => number
}

/**
 * 把 git log 的扁平列表排成泳道图。
 *
 * 输入是 `git log` 的顺序（最新在前），所以子提交先于父提交出现。
 * 规则：
 * - 一个提交默认占最左边还空着的 lane
 * - 它的子提交会「预定」父提交所在的 lane；父提交出现时用第一个预定它的 lane
 * - 其余子提交到父提交的连线就是 merge 线
 */
export function layoutGraph(entries: GitLogEntry[], width = 200): GraphLayout {
  const assigned = new Map<string, { lane: number; row: number }>()
  /** parent hash → 已经排好的子提交（按出现顺序）：子提交画在哪、线从哪个 lane 过来 */
  const claims = new Map<string, { row: number; lane: number; fromLane: number }[]>()
  const active = new Set<number>()
  let maxLane = 0

  const allocate = (): number => {
    for (let i = 0; i <= maxLane; i++) {
      if (!active.has(i)) {
        active.add(i)
        maxLane = Math.max(maxLane, i + 1)
        return i
      }
    }
    const lane = maxLane
    active.add(lane)
    maxLane = lane + 1
    return lane
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  entries.forEach((entry, row) => {
    const incoming = claims.get(entry.hash) ?? []
    const first = incoming[0]
    const lane = first ? first.lane : allocate()

    assigned.set(entry.hash, { lane, row })
    nodes.push({ entry, row, lane, isMerge: entry.parents.length > 1 })

    // 子提交 → 当前提交：每个来汇的 lane 都要画一条线
    for (const claim of incoming) {
      edges.push({
        fromRow: claim.row,
        fromLane: claim.fromLane,
        toRow: row,
        toLane: lane,
      })
    }

    // 第一个父提交继承本 lane（线不断），其余的另开 lane（merge 的分叉）
    const spawned: number[] = []
    let inherits = true
    for (const parent of entry.parents) {
      const placed = assigned.get(parent)
      if (placed) {
        // 父提交已经排在前面（罕见，但要兜住）
        edges.push({ fromRow: row, fromLane: lane, toRow: placed.row, toLane: placed.lane })
        continue
      }
      const parentLane = inherits ? lane : allocate()
      if (!inherits) spawned.push(parentLane)
      inherits = false

      const list = claims.get(parent) ?? []
      list.push({ row, lane: parentLane, fromLane: lane })
      claims.set(parent, list)
    }

    // 没有待续的父提交 = 这条线到此为止，把经过的 lane 都放掉
    const continues = entry.parents.some((p) => !assigned.has(p))
    if (!continues) {
      active.delete(lane)
      for (const claim of incoming) active.delete(claim.lane)
      for (const l of spawned) active.delete(l)
    }
  })

  const laneCount = Math.max(maxLane, 1)
  return {
    nodes,
    edges,
    laneCount,
    width: Math.min(width, LEFT_PAD + laneCount * LANE_WIDTH + 8),
    height: Math.max(entries.length * ROW_HEIGHT, ROW_HEIGHT),
    laneX: (lane: number) => LEFT_PAD + lane * LANE_WIDTH,
    rowY: (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2,
  }
}

export function useGraphLayout(entries: GitLogEntry[]): GraphLayout {
  return useMemo(() => layoutGraph(entries), [entries])
}

/** 边画成折线：竖着下来，需要换 lane 时横移一段。 */
export function edgePath(
  edge: GraphEdge,
  laneX: (lane: number) => number,
  rowY: (row: number) => number,
): string {
  const x1 = laneX(edge.fromLane)
  const x2 = laneX(edge.toLane)
  const y1 = rowY(edge.fromRow)
  const y2 = rowY(edge.toRow)
  if (x1 === x2) return `M ${x1} ${y1} V ${y2}`

  const midY = y1 + (y2 - y1) / 2
  return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`
}
