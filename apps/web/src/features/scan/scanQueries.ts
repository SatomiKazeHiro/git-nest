import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScannedRepo } from '@git-nest/core'
import { api } from '@/lib/api'
import { useInvalidate } from '@/lib/invalidate'
import { queryKeys } from '@/lib/queryKeys'

/** 扫描结果里的一行：扫到的仓库 + 它在清单里的状态（已入库的带 id 与分类） */
export interface ScannedRepoWithProject extends ScannedRepo {
  projectId: number | null
  projectName: string | null
  projectCategory: string | null
}

export interface ScanResponse {
  dir: string
  /** 这次一共发现多少个仓库目录（可能多于 found.length） */
  candidates: number
  /** 是否因为「一次扫描最多列 N 个」而少列了 */
  truncated: boolean
  found: ScannedRepoWithProject[]
}

/**
 * 扫一个目录。**只读**：不写清单、不动磁盘。
 *
 * `remember` 会把目录写进设置，所以要顺带失效 settings——不失效的话新加的
 * 常用目录不会出现在页面上，用户会以为「记住」没生效。
 */
export function useScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { dir: string; depth: number; remember: boolean }) =>
      api.post<ScanResponse>('/scan', input),
    onSuccess: (_data, input) => {
      if (input.remember) void qc.invalidateQueries({ queryKey: queryKeys.settings })
    },
  })
}

/** 把扫出来的仓库批量入库。**写操作**，所以走统一失效。 */
export function useImport() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { paths: string[]; category: string }) =>
      api.post<{ created: { id: number; name: string }[]; skipped: { path: string; reason: string }[] }>(
        '/projects/import',
        input,
      ),
    onSuccess: invalidate,
  })
}
