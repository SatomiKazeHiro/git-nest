import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { server } from '@/test/mocks/server'
import { App } from '@/App'
import { useUiStore } from '@/store/ui'

/**
 * 左栏的「我自己的」筛选。
 *
 * 两条容易被写坏的性质：
 *
 * 1. **它和分类 / 标签是叠加的，不是互斥的。** 「我的 tools」是一个完全合理的
 *    查询，所以点它不该把分类清掉。反过来，分类与标签之间是互斥的（它们是同一层
 *    的两种分组方式），点一个会取消另一个——那两条已经这样了。
 * 2. **它走服务端筛选，不是前端过滤。** 前端过滤等于把整份清单拉下来再筛，
 *    搜索也会跟着失灵。判据是列表请求的 URL 上有没有 `own=1`。
 */

function makeProject(id: number, name: string, isOwn: boolean) {
  return {
    id,
    name,
    path: `D:/repos/${name}`,
    remoteUrl: null,
    isOwn,
    category: 'tools',
    record: '',
    addedAt: '2026-10-01T00:00:00Z',
    sortOrder: id,
    tags: [],
    latestCheck: null,
  }
}

/** 记下每次列表请求带了什么查询参数 */
let seen: URLSearchParams[]

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, gcTime: 0 } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<App />, { wrapper: Wrapper })
}

beforeEach(() => {
  seen = []
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null, own: null },
    formOpen: false,
    editingId: null,
    navOpen: true,
    detailOpen: true,
  })
  server.use(
    http.get('/api/projects', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url.searchParams)
      const all = [makeProject(1, 'mine', true), makeProject(2, 'theirs', false)]
      const own = url.searchParams.get('own')
      const category = url.searchParams.get('category')
      const list = all
        .filter((p) => (own === null ? true : p.isOwn === (own === '1')))
        .filter((p) => (category ? p.category === category : true))
      return HttpResponse.json({ projects: list })
    }),
    http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    http.get('/api/status', () => HttpResponse.json({ statuses: [] })),
  )
})

describe('「我自己的」筛选', () => {
  it('左栏只在真的有自己写的项目时出现这一项，并带上计数', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    const item = screen.getByRole('button', { name: /我自己的/ })
    expect(item.textContent).toContain('1')
  })

  it('点一下筛到自己的，再点一下取消（走服务端，不是前端过滤）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /我自己的/ }))
    await waitFor(() => expect(seen.some((q) => q.get('own') === '1')).toBe(true))
    await waitFor(() => expect(screen.queryByText('theirs')).toBeNull())
    expect(screen.getByText('mine')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /我自己的/ }))
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
  })

  it('与分类叠加：「我的 tools」是一个合理的查询，两个条件都发到服务端', async () => {
    useUiStore.setState({
      filters: { q: '', category: 'tools', tag: null, own: '1' },
    })
    renderApp()

    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())
    const last = seen[seen.length - 1]!
    expect(last.get('own')).toBe('1')
    expect(last.get('category')).toBe('tools')
    // 选了分类之后清掉「我自己的」不该顺带发生——所以这一项仍然是开着的
    expect(useUiStore.getState().filters.category).toBe('tools')
    expect(useUiStore.getState().filters.own).toBe('1')
  })
})
