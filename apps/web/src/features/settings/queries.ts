import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Settings {
  includeOwn: boolean
  gitTimeoutMs: number
  concurrency: number
  confirmThreshold: number
  scanDirs: string[]
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
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
      qc.setQueryData(['settings'], settings)
    },
  })
}
