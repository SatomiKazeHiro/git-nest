import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MAX_STATUS_IDS, type RepoStatus } from '@git-nest/core'
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

function idList(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b)
}

function sortedIds(ids: number[]): string {
  return idList(ids).join(',')
}

/**
 * 列表页一次问全部状态（**超过上限会自动分块**）。
 *
 * 原来是一发一条、把当前筛出的全部 id 都塞进 URL：项目超过 200 个时服务端 400，
 * 而页面把那个错误丢掉了 —— 于是每一行永远显示「读状态…」，用户看不出是为什么。
 * 现在按服务端同一个常量（`MAX_STATUS_IDS`）切片，正常路径永远碰不到那条上限。
 *
 * 分块是**顺序**的：服务端的 scheduler 本来就是全局并发上限（默认 4），同时打几发
 * 只会互相抢那几个槽、还容易把 3 秒短缓存打散。失败由调用方负责显示出来
 * （`useStatuses` 的 error）——静默失败比慢更糟。
 */
export function useStatuses(ids: number[]) {
  return useQuery({
    queryKey: statusKeys.batch(ids),
    queryFn: async () => {
      const all = idList(ids)
      const merged = new Map<number, RepoStatus>()
      for (let i = 0; i < all.length; i += MAX_STATUS_IDS) {
        const chunk = all.slice(i, i + MAX_STATUS_IDS)
        const res = await api.get<{ statuses: ProjectStatus[] }>(`/status?ids=${chunk.join(',')}`)
        for (const s of res.statuses) merged.set(s.projectId, s.status)
      }
      return merged
    },
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
