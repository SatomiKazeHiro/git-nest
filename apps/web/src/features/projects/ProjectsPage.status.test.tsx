import { describe, expect, it, beforeEach } from 'vitest'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { MAX_STATUS_IDS } from '@git-nest/core'
import { server } from '@/test/mocks/server'
import { useStatuses } from '@/features/status/queries'
import { ProjectsPage } from './ProjectsPage'
import { useUiStore } from '@/store/ui'

/**
 * 清单页「状态」那一列的两件事：
 *
 * 1. **超过服务端上限要自动分块**（用的是同一个常量）。原来是一发一条把当前筛出的
 *    全部 id 塞进 URL：项目超过 200 个时服务端 400，而页面把那个错误丢了 → 每一行
 *    永远显示「读状态…」。这条用 `renderHook` 直接测取数逻辑——渲染 205 行表格
 *    在并行跑的全量套件里会压过默认超时，而它要证明的只是「怎么分块」。
 * 2. **读不出来要说出来**。静默失败比慢更糟：清单本身是好的，用户至少要知道
 *    「落后 / 远程更新 / 上次检查」这几列为什么是空的。
 */

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      // 与 main.tsx 一套默认值：不做窗口聚焦重取，否则会被别的用例触发的
      // focus 事件带出额外请求，断言就不稳了
      queries: { refetchOnWindowFocus: false, retry: false, staleTime: 0, gcTime: 0 },
    },
  })
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
}

function makeProject(id: number) {
  return {
    id,
    name: `repo-${String(id).padStart(3, '0')}`,
    path: `D:/repos/repo-${id}`,
    remoteUrl: null,
    category: 'tools',
    record: '',
    addedAt: '2026-10-01T00:00:00Z',
    sortOrder: id,
    tags: [],
    latestCheck: null,
  }
}

function statusFor(id: number) {
  return {
    path: `D:/repos/repo-${id}`,
    checkedAt: '2026-10-05T00:00:00Z',
    isRepo: true,
    branch: 'main',
    detached: false,
    dirty: false,
    dirtyCount: 0,
    dirtyTracked: 0,
    dirtyUntracked: 0,
    upstream: 'origin/main',
    upstreamGone: false,
    ahead: 0,
    behind: 3,
    remoteUrl: null,
    lastCommit: null,
    recommendation: null,
    status: 'behind',
    error: null,
  }
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let chunkSizes: number[]
let seen: Set<number>

beforeEach(() => {
  chunkSizes = []
  seen = new Set()
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null, own: null },
    formOpen: false,
    editingId: null,
  })
  // 「编辑资料」弹窗现在挂在窗口外壳上，不在这棵树里；这条 mock 是留给
  // 将来清单页自己要用标签时准备的。留着无害，去掉也不会红。
  server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [] })))
})

const statusHandler = http.get('/api/status', ({ request }) => {
  const url = new URL(request.url)
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
  chunkSizes.push(ids.length)
  for (const id of ids) seen.add(Number(id))
  return HttpResponse.json({
    statuses: ids.map((id) => ({ projectId: Number(id), status: statusFor(Number(id)) })),
  })
})

describe('批量状态的分块', () => {
  it(`超过 ${MAX_STATUS_IDS} 个项目：分成多发，每一发都不超上限、合起来不缺不多`, async () => {
    const total = MAX_STATUS_IDS + 50
    server.use(statusHandler)

    const { result } = renderHook(
      () => useStatuses(Array.from({ length: total }, (_, i) => i + 1)),
      { wrapper },
    )

    await waitFor(() => expect(result.current.data?.size).toBe(total))

    // 两发：200 + 50。原来是一发全塞进 URL → 服务端 400 → 前端把错误丢了
    // → 每一行永远「读状态…」。
    expect(chunkSizes).toEqual([MAX_STATUS_IDS, total - MAX_STATUS_IDS])
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(MAX_STATUS_IDS)
    expect(seen.size).toBe(total)
  })

  it(`不超过 ${MAX_STATUS_IDS} 个时只发一次（别为了分块把短请求也拆开）`, async () => {
    server.use(statusHandler)

    const { result } = renderHook(() => useStatuses([3, 1, 2]), { wrapper })
    await waitFor(() => expect(result.current.data?.size).toBe(3))

    expect(chunkSizes).toEqual([3])
    // 排序去重之后再发：同一个集合不管顺序如何都是同一条缓存
    expect([...seen]).toEqual([1, 2, 3])
  })
})

describe('清单页的状态列', () => {
  it('正常拿到状态：每一行显示落后数字', async () => {
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json({ projects: [makeProject(1), makeProject(2)] }),
      ),
      statusHandler,
    )

    renderPage()
    await waitFor(() => expect(screen.getByText('repo-001')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByText('↓3')).toHaveLength(2))
    expect(screen.queryByText('读状态…')).toBeNull()
  })

  it('状态读不出来：给出可重试的提示，而不是永远显示「读状态…」', async () => {
    server.use(
      http.get('/api/projects', () => HttpResponse.json({ projects: [makeProject(1)] })),
      http.get('/api/status', () =>
        HttpResponse.json(
          { code: 'internal_error', message: '服务器出错了，看日志' },
          { status: 500 },
        ),
      ),
    )

    renderPage()
    await waitFor(() => expect(screen.getByText('repo-001')).toBeTruthy())

    await waitFor(() => expect(screen.getByText(/读不到仓库状态/)).toBeTruthy())
    expect(screen.getByText(/服务器出错了/)).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
  })
})
