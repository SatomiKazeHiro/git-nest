/**
 * 设置这个资源的数据访问。
 *
 * `queryKeys.settings` 而不是字面量 `['settings']`：这个字面量以前在本文件出现
 * 两次、在 `ScanSection.tsx` 出现一次，而它的**根**又被项目那边的键表声明过
 * ——同一串名字四个来源，改一处其余静默失效。现在只有 `lib/queryKeys.ts` 一份。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export interface Settings {
  includeOwn: boolean
  gitTimeoutMs: number
  concurrency: number
  confirmThreshold: number
  scanDirs: string[]
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<{ settings: Settings }>('/settings').then((r) => r.settings),
    staleTime: 60_000,
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      api.patch<{ settings: Settings }>('/settings', patch).then((r) => r.settings),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings, settings)
    },
  })
}
