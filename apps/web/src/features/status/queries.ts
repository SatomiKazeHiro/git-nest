import { useQuery } from '@tanstack/react-query'
import type { RepoStatus } from '@git-nest/core'
import { api } from '@/lib/api'

export interface ProjectStatus {
  projectId: number
  status: RepoStatus
}

export const statusKeys = {
  batch: (ids: number[]) => ['status', ids.join(',')] as const,
  one: (id: number, fresh: boolean, nonce: number) => ['status', 'one', id, fresh, nonce] as const,
}

/**
 * 列表页一次问全部状态。ids 为空时不发请求。
 * 后端有 3 秒短缓存，连着切两次筛选不会把 git 跑两遍。
 */
export function useStatuses(ids: number[]) {
  return useQuery({
    queryKey: statusKeys.batch(ids),
    queryFn: () =>
      api
        .get<{ statuses: ProjectStatus[] }>(`/status?ids=${ids.join(',')}`)
        .then((r) => new Map(r.statuses.map((s) => [s.projectId, s.status]))),
    enabled: ids.length > 0,
    staleTime: 3_000,
  })
}

export function useProjectStatus(
  id: number | null,
  options: { fresh?: boolean; nonce?: number } = {},
) {
  const fresh = options.fresh ?? false
  return useQuery({
    // nonce 变化就重新发一次请求：手动「重新读取」要绕开服务端那 3 秒短缓存
    queryKey: statusKeys.one(id ?? 0, fresh, options.nonce ?? 0),
    queryFn: () =>
      api
        .get<{ status: RepoStatus }>(`/projects/${id}/status${fresh ? '?fresh=true' : ''}`)
        .then((r) => r.status),
    enabled: id !== null,
    staleTime: 3_000,
  })
}
