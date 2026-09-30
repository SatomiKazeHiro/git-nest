import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProjectDetail, ProjectListItem, Tag } from '@git-nest/core'
import { api } from '@/lib/api'

export interface TagWithUsage extends Tag {
  projectCount: number
}

export const queryKeys = {
  projects: (params: { category?: string | null; tag?: string | null; q?: string }) =>
    ['projects', params] as const,
  project: (id: number) => ['project', id] as const,
  tags: ['tags'] as const,
}

function toQuery(params: { category?: string | null; tag?: string | null; q?: string }) {
  const search = new URLSearchParams()
  if (params.category) search.set('category', params.category)
  if (params.tag) search.set('tag', params.tag)
  if (params.q) search.set('q', params.q)
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export function useProjects(params: { category?: string | null; tag?: string | null; q?: string }) {
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

/** 任何写操作后都让清单与标签重新对齐 */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['projects'] })
    void qc.invalidateQueries({ queryKey: ['project'] })
    void qc.invalidateQueries({ queryKey: ['tags'] })
  }
}

export interface ProjectPayload {
  name: string
  path: string
  category: string
  remoteUrl: string | null
  sourceUrl: string | null
  summary: string | null
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

export function useAddNote() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      api.post<{ noteId: number }>(`/projects/${id}/notes`, { content }),
    onSuccess: invalidate,
  })
}

export function useUpdateNote() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      api.patch<{ ok: true }>(`/notes/${id}`, { content }),
    onSuccess: invalidate,
  })
}

export function useRemoveNote() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/notes/${id}`),
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
