/**
 * 状态这个资源的数据访问。
 *
 * **缓存键在 `lib/queryKeys.ts`**（`statusRoot` / `statusBatch` / `statusOne`）。
 * 它们以前就定义在这个文件里（`statusKeys`），于是 `['status']` 这个根在
 * `features/projects/queries.ts` 里还有一份——同一个名字两处声明，
 * 改一处另一处不会报错，只会**默默地不再失效**。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MAX_STATUS_IDS, type RepoStatus } from '@git-nest/core'
import { api } from '@/lib/api'
import { normalizedIds, queryKeys } from '@/lib/queryKeys'

 interface ProjectStatus {
  projectId: number
  status: RepoStatus
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
    queryKey: queryKeys.statusBatch(ids),
    queryFn: async () => {
      // 与键用同一个归一：键里是排序去重后的 id，请求也必须按同一顺序切块
      const all = normalizedIds(ids)
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
    queryKey: queryKeys.statusOne(id ?? 0),
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
      qc.setQueryData(queryKeys.statusOne(id ?? 0), status)
    },
  })

  return { ...query, refresh }
}
