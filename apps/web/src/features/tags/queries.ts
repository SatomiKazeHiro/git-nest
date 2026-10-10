/**
 * 标签这个资源的数据访问。
 *
 * **为什么它不在 `features/projects/queries.ts` 里**：标签是一张独立表
 * （`tags` + `project_tags`），不是项目的一个字段。挂在项目底下时，
 * 「设置页里那一段管标签的界面」为了读写标签，必须先 import 项目这个 feature
 * ——`features/settings → features/projects` 那条边就是这么来的，
 * 而它说不通：管标签为什么要有项目模块的概念？
 *
 * 拆出来之后，settings 只认识 tags。**「标签挂在项目身上」这件事本身没有变**
 * （项目的表单要选标签、详情页要显示标签），变的是**谁拥有读写它的接口**。
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Tag } from '@git-nest/core'
import { api } from '@/lib/api'
import { useInvalidate } from '@/lib/invalidate'
import { queryKeys } from '@/lib/queryKeys'

/** 标签 + 用了它的项目数（设置页要显示「3 个项目」） */
 interface TagWithUsage extends Tag {
  projectCount: number
}

export function useTags() {
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.get<{ tags: TagWithUsage[] }>('/tags').then((r) => r.tags),
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
