import { useQuery } from '@tanstack/react-query'
import type { GitLogEntry } from '@git-nest/core'
import { api } from '@/lib/api'

/**
 * 提交记录的取数。
 *
 * **与渲染库无关**：这里只关心「从后端拿什么」，不关心拿到之后画成什么样。
 * 与库绑定的部分（字段映射 + `<GitLog>`）都在 `GitGraph.tsx` —— 那个文件是
 * 换渲染方式时**唯一**要动的地方（设计文档第 13 节第 7 条的要求）。
 *
 * 和 `features/status/queries.ts`、`features/projects/queries.ts` 保持同一种
 * 组织方式：一个 feature 的取数放自己的 `queries.ts`。
 */

export interface RepoLog {
  entries: GitLogEntry[]
  /** 当前检出的分支名（detached 时是 HEAD） */
  branch: string
}

export const logKeys = {
  /** 失效时用的前缀（`invalidateQueries` 按前缀匹配） */
  prefix: ['log'] as const,
  repo: (projectId: number | null, max: number) => ['log', projectId, max] as const,
}

export function useRepoLog(projectId: number | null, max = 120) {
  return useQuery({
    queryKey: logKeys.repo(projectId, max),
    queryFn: () => api.get<RepoLog>(`/projects/${projectId}/log?max=${max}`),
    enabled: projectId !== null,
    staleTime: 10_000,
  })
}
