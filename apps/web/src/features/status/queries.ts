import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RepoStatus } from '@git-nest/core'
import { api } from '@/lib/api'

export interface ProjectStatus {
  projectId: number
  status: RepoStatus
}

export const statusKeys = {
  /**
   * 批量状态的 key。**排序去重之后再拼**：`[1,2]` 与 `[2,1]` 是同一批仓库，
   * 不该是两条缓存（同一屏数据缓存两份，翻页/勾选顺序一变就多跑一轮 git）。
   */
  batch: (ids: number[]) => ['status', sortedIds(ids)] as const,
  /**
   * 单个项目的状态。**key 里不带「这次要不要绕缓存」**：
   * 那是一次请求的参数，不是数据身份；放进 key 会（a）每点一次「重读本地状态」
   * 多一条永不复用的缓存条目，（b）让 `fresh` 粘在后续所有自动重取上
   * ——手动动作污染自动读取。
   */
  one: (id: number) => ['status', 'one', id] as const,
}

function sortedIds(ids: number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(',')
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
        .get<{ statuses: ProjectStatus[] }>(`/status?ids=${sortedIds(ids)}`)
        .then((r) => new Map(r.statuses.map((s) => [s.projectId, s.status]))),
    enabled: ids.length > 0,
    staleTime: 3_000,
  })
}

/**
 * 单仓库状态。
 *
 * `refresh()` 是「重读本地状态」那个按钮：它**不联网**，只绕开服务端那 3 秒短缓存
 * 重读一次本机 git。做成 mutation 而不是「把 fresh 拼进 query key」，
 * 是为了让「这一次请求绕缓存」这件事不污染 query 的身份：
 * 读完把结果写回同一条缓存，之后自动重取走的还是普通路径。
 */
export function useProjectStatus(id: number | null) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: statusKeys.one(id ?? 0),
    queryFn: () =>
      api.get<{ status: RepoStatus }>(`/projects/${id}/status`).then((r) => r.status),
    enabled: id !== null,
    staleTime: 3_000,
  })

  const refresh = useMutation({
    mutationFn: async () => {
      if (id === null) throw new Error('没有项目 id')
      return api.get<{ status: RepoStatus }>(`/projects/${id}/status?fresh=true`).then((r) => r.status)
    },
    onSuccess: (status) => {
      qc.setQueryData(statusKeys.one(id ?? 0), status)
    },
  })

  return { ...query, refresh }
}
