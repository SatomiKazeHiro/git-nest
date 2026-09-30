import { useQuery } from '@tanstack/react-query'
import type { GitLogEntry } from '@git-nest/core'
import { api } from '@/lib/api'
import { ROW_HEIGHT, edgePath, useGraphLayout } from './layout'
import { formatRelative } from '@/lib/format'

export function useRepoLog(projectId: number | null, max = 120) {
  return useQuery({
    queryKey: ['log', projectId, max],
    queryFn: () =>
      api
        .get<{ entries: GitLogEntry[] }>(`/projects/${projectId}/log?max=${max}`)
        .then((r) => r.entries),
    enabled: projectId !== null,
    staleTime: 10_000,
  })
}

/**
 * 提交图。
 *
 * 设计文档写的是「react-git-log 作为可插拔弱依赖，不可用则自研泳道图替换」。
 * 这里用的是自研版本：数据来自 core 的 getLog，排布逻辑都在 layout.ts 里，
 * 将来要换成 react-git-log，只需替换这个组件的内部实现。
 */
export function GitGraph({ projectId }: { projectId: number | null }) {
  const { data: entries, isPending, error } = useRepoLog(projectId)
  const layout = useGraphLayout(entries ?? [])

  if (error) {
    return (
      <p className="py-6 text-[13px] text-ink-2">读不到提交记录，这个目录可能不是 git 仓库。</p>
    )
  }
  if (isPending) {
    return <p className="py-6 font-mono text-[13px] text-ink-3">正在读提交记录…</p>
  }
  if (entries.length === 0) {
    return <p className="py-6 text-[13px] text-ink-3">这个仓库还没有提交。</p>
  }

  return (
    <div className="relative overflow-x-auto">
      <svg
        className="pointer-events-none absolute top-0 left-0"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        {layout.edges.map((edge, i) => (
          <path
            key={i}
            d={edgePath(edge, layout.laneX, layout.rowY)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={1.2}
          />
        ))}
        {layout.nodes.map((node) => (
          <circle
            key={node.entry.hash}
            cx={layout.laneX(node.lane)}
            cy={layout.rowY(node.row)}
            r={node.isMerge ? 4 : 3.2}
            fill={node.isMerge ? 'var(--color-paper)' : 'var(--color-accent)'}
            stroke="var(--color-accent)"
            strokeWidth={1.4}
          />
        ))}
      </svg>

      <ul className="min-w-max">
        {layout.nodes.map((node) => (
          <li
            key={node.entry.hash}
            className="row-link flex items-center gap-3 pr-3"
            style={{ height: ROW_HEIGHT }}
          >
            {/* 泳道是绝对定位的那层 SVG，这里只留同宽的占位把文字推到右边 */}
            <span className="shrink-0" style={{ width: layout.width }} />
            <span className="w-16 shrink-0 font-mono text-[11.5px] text-ink-3">
              {node.entry.shortHash}
            </span>
            <span className="w-28 shrink-0 truncate text-[12px] text-ink-3">
              {node.entry.authorName}
            </span>
            <span className="w-24 shrink-0 font-mono text-[11.5px] text-ink-3">
              {formatRelative(node.entry.date)}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {node.isMerge ? (
                <span className="shrink-0 rounded-[2px] border border-line px-1 font-mono text-[10px] text-ink-3">
                  merge
                </span>
              ) : null}
              <span className="truncate text-[13px] text-ink">{node.entry.subject}</span>
              <RefLabels refs={node.entry.refs} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RefLabels({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null
  return (
    <span className="flex shrink-0 gap-1">
      {refs.slice(0, 3).map((ref) => (
        <span
          key={ref}
          className="rounded-[2px] border border-line px-1 font-mono text-[10.5px] text-ink-2"
        >
          {ref}
        </span>
      ))}
    </span>
  )
}
