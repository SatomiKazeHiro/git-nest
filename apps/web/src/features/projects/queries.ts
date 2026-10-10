/**
 * 项目的读写。
 *
 * **缓存键与失效政策不在这里**：键在 `lib/queryKeys.ts`（唯一一张表），
 * 写后失效在 `lib/invalidate.ts`。两者都下沉到 `lib/`，是为了不出现
 * feature ↔ feature 的边——`settings` / `updates` / `readme` 以前都得
 * import 这个文件才能干活。理由写在那两个文件各自的头部。
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ProjectDetail, ProjectListItem } from '@git-nest/core'
import { api } from '@/lib/api'
import { useInvalidate } from '@/lib/invalidate'
import { queryKeys, type ListParams } from '@/lib/queryKeys'

/**
 * 列表参数 → 线路上那串 query string。
 *
 * 参数的**类型**住在 `lib/queryKeys.ts`，因为它同时是缓存键的身份；
 * 这里只管把同一个对象编码成请求。键要的是对象本身，请求要的是规范化字符串，
 * 两件事分开写。
 */
function toQuery(params: ListParams) {
  const search = new URLSearchParams()
  // 空串是**合法取值**（「只看没分类的」），所以不能用真值判断——
  // 那样 category='' 会被当成「没这个筛选」，侧栏里「未分类」点了等于没点。
  // （这个坑在服务端与前端各犯过一次，加上测试 mock 里那次，一共三次。）
  if (params.category !== null && params.category !== undefined) {
    search.set('category', params.category)
  }
  if (params.tag) search.set('tag', params.tag)
  if (params.q) search.set('q', params.q)
  // 布尔要显式发 '0'：只发 '1' 的话「关掉筛选」与服务端返回的「不过滤」同义，
  // 切回「都要」就没有请求能发出去了
  if (params.own) search.set('own', params.own)
  if (params.attention) search.set('attention', params.attention)
  if (params.sort) search.set('sort', params.sort)
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export function useProjects(params: ListParams) {
  return useQuery({
    queryKey: queryKeys.projects(params),
    queryFn: () =>
      api.get<{ projects: ProjectListItem[] }>(`/projects${toQuery(params)}`).then((r) => r.projects),
  })
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: queryKeys.project(id ?? 0),
    queryFn: () => api.get<{ project: ProjectDetail }>(`/projects/${id}`).then((r) => r.project),
    enabled: id !== null,
  })
}

export interface ProjectPayload {
  name: string
  path: string
  category: string
  remoteUrl: string | null
  record: string
}

export function useCreateProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (payload: ProjectPayload) =>
      api.post<{ project: ProjectDetail }>('/projects', payload),
    onSuccess: invalidate,
  })
}

export function useUpdateProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ProjectPayload> }) =>
      api.patch<{ project: ProjectDetail }>(`/projects/${id}`, patch),
    onSuccess: invalidate,
  })
}

export function useRemoveProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => api.del<{ removed: number }>(`/projects/${id}`),
    onSuccess: invalidate,
  })
}

export function useSetProjectTags() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, tagNames }: { id: number; tagNames: string[] }) =>
      api.put<{ project: ProjectDetail }>(`/projects/${id}/tags`, { tagNames }),
    onSuccess: invalidate,
  })
}
