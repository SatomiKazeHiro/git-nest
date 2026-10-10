import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Attention, ProjectDetail, ProjectListItem, ProjectSort, Tag } from '@git-nest/core'
import { api } from '@/lib/api'

export interface TagWithUsage extends Tag {
  projectCount: number
}

/**
 * 所有 query key。写操作后需要失效哪些前缀，统一看 `invalidateAll`，
 * 别在各个组件里各写一份（以前 UpdatePanel / ScanSection / 这里各有一份，
 * 加一个 key 就要改三处）。
 */
export const queryKeys = {
  projects: (params: ListParams) => ['projects', params] as const,
  project: (id: number) => ['project', id] as const,
  /** 所有项目详情的**前缀**：失效时用它，不要用 `project(0)`（见 useInvalidate） */
  projectAll: ['project'] as const,
  tags: ['tags'] as const,
  status: ['status'] as const,
  settings: ['settings'] as const,
  /** README 全文。`full` 进 key，所以「加载完整文档」就是换一条查询 */
  readme: (id: number, full: boolean) => ['readme', id, full] as const,
}

/** 列表查询的参数。`own` 是 '1'/'0'，与 category / tag **叠加**而非互斥。 */
export interface ListParams {
  category?: string | null
  tag?: string | null
  q?: string
  /** 三态：'1' 只看自己的 / '0' 只看不是自己的 / 不传都要。store 里是 null。 */
  own?: '1' | '0' | null
  /** 行动分类筛选；与其它维度叠加。store 里是 null。 */
  attention?: Attention | null
  /** 排序；null = 服务端默认（分类分组 → 名称） */
  sort?: ProjectSort | null
}

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

export function useTags() {
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.get<{ tags: TagWithUsage[] }>('/tags').then((r) => r.tags),
  })
}

/**
 * 任何写操作后都让清单与标签重新对齐。
 *
 * 这里是**唯一**的失效入口：状态列、检查时间、设置都可能被一次写入影响
 * （比如删项目会清状态缓存、导入会改常用目录），所以一起失效最省心，
 * 也免得某处漏掉一个 key 导致界面停在旧数据上。
 *
 * ⚠️ 详情那一行必须是**前缀** `['project']`，不能写成 `queryKeys.project(0)`：
 * TanStack 的失效是前缀匹配，`['project', 0]` 只匹配 id 恰好为 0 的那条
 * （那是「没选中任何项目」时 `enabled: false` 的占位键），
 * 于是**任何写操作都失效不掉 `['project', id]`**——改完资料详情页还是旧名字、
 * 旧分类、旧记录，用户会以为没保存。这条踩过一次，注释钉在这里。
 */
export function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.projects({}) })
    void qc.invalidateQueries({ queryKey: queryKeys.projectAll })
    void qc.invalidateQueries({ queryKey: queryKeys.tags })
    void qc.invalidateQueries({ queryKey: queryKeys.status })
    void qc.invalidateQueries({ queryKey: queryKeys.settings })
  }
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

export function useCreateTag() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { name: string; color: string | null }) =>
      api.post<{ tag: Tag }>('/tags', input),
    onSuccess: invalidate,
  })
}

export function useRemoveTag() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/tags/${id}`),
    onSuccess: invalidate,
  })
}
