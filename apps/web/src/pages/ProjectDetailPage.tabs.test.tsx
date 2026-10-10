import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { server } from '@/test/mocks/server'
import { ProjectDetailPage } from './ProjectDetailPage'

/**
 * 详情栏的标签页。
 *
 * 钉住三件事：
 * 1. **默认落在概览**——打开一个项目先看到它现在什么状态，这是最常见的需求。
 * 2. **键盘到得了**：左右方向键切换，Tab 键从标签栏进到内容区。
 * 3. **切换不改 URL**：「正在看哪个项目」住在 URL 里，「看它的哪一页」是这一次
 *    看的局部状态。改了 URL 的话，浏览器的前进后退就会开始记录「我翻到第几页」，
 *    而那不是一个值得记的动作。
 */

const project = {
  id: 1,
  name: 'demo',
  path: 'D:/repos/demo',
  remoteUrl: null,
  isOwn: false,
  category: '',
  record: '',
  addedAt: '2026-10-01T00:00:00Z',
  sortOrder: 1,
  tags: [],
  latestCheck: null,
  attention: 'ready',
}

const status = {
  path: 'D:/repos/demo',
  checkedAt: '2026-10-05T00:00:00Z',
  isRepo: true,
  branch: 'main',
  detached: false,
  dirty: false,
  dirtyCount: 0,
  dirtyTracked: 0,
  dirtyUntracked: 0,
  upstream: null,
  upstreamGone: false,
  ahead: null,
  behind: null,
  remoteUrl: null,
  lastCommit: null,
  recommendation: null,
  status: 'no_upstream',
  error: null,
}

/** 把当前位置印出来，这样「切换不改 URL」才是一条真断言而不是空断言 */
function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="location">{loc.pathname + loc.search}</span>
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, gcTime: 0 } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/1']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(
    <Wrapper>
      <LocationProbe />
      {/* `useParams()` 要有 `<Route>` 才拿得到 id——少这一层的话页面会一直停在
          「正在读项目…」，而断言报的是「找不到 demo」，看着像数据没来，其实在测一个空壳 */}
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </Wrapper>,
  )
}

beforeEach(() => {
  server.use(
    http.get('/api/projects/:id', () => HttpResponse.json({ project })),
    http.get('/api/projects/:id/status', () => HttpResponse.json({ status })),
    http.get('/api/projects/:id/readme', () =>
      HttpResponse.json({
        file: 'README.md',
        content: '# 说明标题\n\n正文。\n',
        truncated: false,
        bytes: 30,
      }),
    ),
    http.get('/api/settings', () =>
      HttpResponse.json({
        settings: {
          includeOwn: false,
          gitTimeoutMs: 120000,
          concurrency: 4,
          confirmThreshold: 20,
          scanDirs: [],
        },
      }),
    ),
  )
})

describe('详情栏的标签页', () => {
  it('有两个标签页，默认落在概览', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['概览', 'README'])
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')
    // 概览的内容在（「推不推荐更新」是它第一个分区）
    expect(screen.getByRole('heading', { name: '推不推荐更新' })).toBeTruthy()
  })

  it('点 README → 概览的内容让位，README 的内容进来', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())

    fireEvent.click(screen.getByRole('tab', { name: 'README' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '说明标题' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'README' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('heading', { name: '推不推荐更新' })).toBeNull()
  })

  it('**左右方向键能切**（不是只能点）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())

    const overview = screen.getByRole('tab', { name: '概览' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'README' }).getAttribute('aria-selected')).toBe('true'),
    )

    const readme = screen.getByRole('tab', { name: 'README' })
    fireEvent.keyDown(readme, { key: 'ArrowLeft' })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true'),
    )
  })

  it('**切换不改 URL**', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())
    const before = screen.getByTestId('location').textContent

    fireEvent.click(screen.getByRole('tab', { name: 'README' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '说明标题' })).toBeTruthy())

    expect(screen.getByTestId('location').textContent).toBe(before)
    expect(before).toBe('/projects/1')
  })

  it('「加入清单于」在标签页外面——它说的是这个项目，不是这一页', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())

    fireEvent.click(screen.getByRole('tab', { name: 'README' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '说明标题' })).toBeTruthy())
    // 概览那一页已经不在了，但这一行还在
    expect(screen.queryByRole('heading', { name: '推不推荐更新' })).toBeNull()
    expect(screen.getByText(/加入清单于/)).toBeTruthy()
  })

  it('未选中的标签不进 Tab 序（整组只占一个停靠点）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'README' }).getAttribute('tabindex')).toBe('-1')
  })
})