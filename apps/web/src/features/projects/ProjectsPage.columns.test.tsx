import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { server } from '@/test/mocks/server'
import { ProjectsPage } from './ProjectsPage'
import { useUiStore } from '@/store/ui'

/**
 * 清单改成六列：仓库（含路径）/ 当前分支 / 状态 / 同步状态 / 差异 / 上次检查。
 *
 * 两条不能丢的性质：
 * - **状态列读服务端给的 `attention`，不自己按 verdict 算。** 显示、筛选、
 *   侧栏计数三处共用同一份判定（`ATTENTION_SQL`），前端再写一遍就必然漂。
 * - **措辞按新鲜度降级，但分类不变。** 超过 12 小时的检查，分类仍然是
 *   `synced`（筛选不受影响），只是话说成「上次看是…」（不变量 5）。
 */

const project = (over: Record<string, unknown> = {}) => ({
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
  ...over,
})

const status = (over: Record<string, unknown> = {}) => ({
  path: 'D:/repos/demo',
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
  behind: 0,
  remoteUrl: null,
  lastCommit: null,
  recommendation: null,
  status: 'behind',
  error: null,
  ...over,
})

const check = (over: Record<string, unknown> = {}) => ({
  checkedAt: '2026-10-05T00:00:00.000Z',
  status: 'behind',
  aheadCount: 0,
  behindCount: 0,
  recommendation: null,
  ...over,
})

beforeEach(() => {
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null, own: null, attention: null, sort: null },
    formOpen: false,
    editingId: null,
    navOpen: true,
    detailOpen: true,
  })
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<ProjectsPage />, { wrapper: Wrapper })
}

const mockAll = (p: Record<string, unknown>, s: Record<string, unknown>) => {
  server.use(
    http.get('/api/projects', () => HttpResponse.json({ projects: [p], total: 1 })),
    http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    http.get('/api/status', () => HttpResponse.json({ statuses: [{ projectId: 1, status: s }] })),
  )
}

describe('列表六列', () => {
  it('表头是 仓库 / 当前分支 / 状态 / 同步状态 / 差异 / 上次检查', async () => {
    mockAll(project(), status())
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())

    for (const name of ['仓库', '当前分支', '状态', '同步状态', '差异', '上次检查']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy()
    }
    // 标签列按概念图去掉了；路径并进「仓库」那一格
    expect(screen.queryByRole('columnheader', { name: '标签' })).toBeNull()
    expect(screen.getByText('D:/repos/demo')).toBeTruthy()
  })

  it('状态列读服务端给的 attention，不自己按 verdict 算', async () => {
    mockAll(project({ attention: 'blocked' }), status())
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())
    expect(screen.getByText('不推荐')).toBeTruthy()
  })

  it('差异两个方向都给', async () => {
    mockAll(project(), status({ ahead: 2, behind: 5 }))
    renderPage()
    // 状态是第二次查询才回来的，等它——只等项目名会早一步断言
    await waitFor(() => expect(screen.getByText('↓5')).toBeTruthy())
    expect(screen.getByText('↑2')).toBeTruthy()
  })

  it('同步状态列的四种说法', async () => {
    const cases = [
      [{ upstreamGone: true }, '上游已关闭'],
      [{ ahead: 1, behind: 1 }, '已分叉'],
      [{ behind: 3 }, '远程领先'],
    ] as const
    for (const [over, want] of cases) {
      // msw 的 handler 必须在第一次请求之前装好，所以先 mock 后 render
      mockAll(project(), status(over))
      const { unmount } = renderPage()
      await waitFor(() => expect(screen.getByText(want)).toBeTruthy())
      unmount()
    }
  })

  it('没有合格检查：状态说「待检查」，同步状态说「未知」，不给数字', async () => {
    mockAll(project({ attention: 'unchecked' }), status({ ahead: null, behind: null }))
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())
    expect(screen.getByText('待检查')).toBeTruthy()
    expect(screen.getByText('未知')).toBeTruthy()
    expect(screen.queryByText('↓0')).toBeNull()
  })

  it('检查超过 12 小时：措辞降级，但分类不变（筛选还按分类走）', async () => {
    const old = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    mockAll(
      project({ attention: 'synced', latestCheck: check({ checkedAt: old, status: 'up_to_date' }) }),
      status(),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy())
    expect(screen.getByText('上次看是已同步')).toBeTruthy()
  })

  it('收列用容器查询，不是视口媒体查询', () => {
    // jsdom 不排版，所以这条靠读 CSS 文件断言：挡的是「有人改回 @media」
    // 先剥掉注释：正则 `[^}]*` 会跨行，于是注释里提到 `@media`、
    // 后面又出现 `.col-` 的地方会被误判成「还有视口媒体查询」
    const raw = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8')
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/@container \(width < /)
    expect(css).not.toMatch(/@media[^}]*\.col-/)
  })
})
