import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useInvalidate, queryKeys } from './queries'
import { logKeys } from '@/features/gitgraph/queries'

/**
 * 写操作后的失效入口只有一处（`useInvalidate`），提交图的 key 也在其中。
 *
 * 起因：提交记录的 key 前缀原来在三处各写了一遍（`projects/queries.ts` 的
 * `queryKeys.log`、`UpdatePanel` 里的硬编码 `['log']`、以及 gitgraph 自己的
 * `['log', id, max]`）。拆分 `gitgraph/queries.ts` 时最容易接错的就是这里 ——
 * 失效清单漏了 log，检查完更新之后提交图就停在旧数据上不动。
 *
 * 这里直接断言「失效时真的打到了 log 前缀」，而不是只断言数组里有这个字符串。
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useInvalidate 的失效范围', () => {
  it('提交图那个 key 会被失效（检查完更新后图能刷新）', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    // 放一条提交图缓存进去
    client.setQueryData(logKeys.repo(1, 120), { entries: [], branch: 'main' })

    const spy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useInvalidate(), { wrapper: wrapper(client) })
    act(() => {
      result.current()
    })

    const invalidated = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(invalidated).toContain(JSON.stringify(logKeys.prefix))
  })

  it('清单 / 详情 / 标签 / 状态 / 设置都要失效（一次写操作影响面很广）', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useInvalidate(), { wrapper: wrapper(client) })
    act(() => {
      result.current()
    })

    const invalidated = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    for (const key of [
      queryKeys.projects({}),
      queryKeys.project(0),
      queryKeys.tags,
      queryKeys.status,
      queryKeys.settings,
    ]) {
      expect(invalidated, `${JSON.stringify(key)} 应该在失效清单里`).toContain(
        JSON.stringify(key),
      )
    }
  })
})
