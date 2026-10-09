import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { RepoStatus } from '@git-nest/core'
import { server } from '@/test/mocks/server'
import { App } from '@/App'
import { useUiStore } from '@/store/ui'

/**
 * 列表的 lean 档与详情的 full 档**必须继续分开**（STATUS.md 不变量 8）。
 *
 * 两档读的东西不一样：lean 不读工作区（`dirty` 恒为 false）也不读最后提交
 * （`lastCommit` 恒为 null），因为列表页一次要问几十个仓库；
 * full 档才去读那些，详情页与 `pull` 的前置检查靠它判断工作区干不干净——
 * 而脏标记是「绝不自动更新」那条安全闸的判据，混用会让详情页在几秒内谎报「干净」。
 *
 * 这个隔离原本是**结构性的**：两个端点、两条 query key、两个缓存。
 * 改成三栏布局之后详情栏常驻，这个风险从「以后可能有人合并」变成
 * 「重构时很容易顺手统一」——所以用一条测试把它钉住。
 *
 * 测法：让两个端点返回**不一样的数字**，再断言左边的行显示批量的那个、
 * 右边的详情显示单个的那个。哪天两边共用了一条缓存，必然有一个数字对不上。
 */

function status(overrides: Partial<RepoStatus>): RepoStatus {
  return {
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
    // lean 档读不到这个字段
    lastCommit: null,
    // lean 档不读工作区，判决也就无从谈起
    recommendation: null,
    status: 'behind',
    error: null,
    ...overrides,
  }
}

const project = {
  id: 5,
  name: 'demo',
  path: 'D:/repos/demo',
  remoteUrl: null,
  category: 'tools',
  record: '一条记录',
  addedAt: '2026-10-01T00:00:00Z',
  sortOrder: 1,
  tags: [],
  latestCheck: null,
}

beforeEach(() => {
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null, own: null, attention: null, sort: null },
    formOpen: false,
    editingId: null,
  })
})

describe('三栏布局下，列表与详情仍是两套状态', () => {
  it('清单读批量（lean）的那份，详情读单项目（full）的那份，两者不串', async () => {
    const paths: string[] = []

    server.use(
      http.get('/api/projects', () => HttpResponse.json({ projects: [project] })),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
      // 列表那一列（lean）：落后 3
      http.get('/api/status', ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json({
          statuses: [{ projectId: 5, status: status({ behind: 3 }) }],
        })
      }),
      http.get('/api/projects/5', () => HttpResponse.json({ project })),
      // 详情栏（full）：落后 99
      http.get('/api/projects/5/status', ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json({ status: status({ behind: 99 }) })
      }),
    )

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <MemoryRouter initialEntries={['/projects/5']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // 两边都问过了，而且问的是各自那个端点
    await waitFor(() => {
      expect(paths).toContain('/api/status')
      expect(paths).toContain('/api/projects/5/status')
    })

    // 清单那一行显示的是 lean 的数字
    await waitFor(() => expect(screen.getByText('↓3')).toBeTruthy())
    // 详情栏显示的是 full 的数字。两个数字都在，且各自归位——
    // 一旦共用缓存，其中一个会被另一个顶掉。
    const summary = await screen.findByTestId('status-summary')
    expect(summary.textContent).toContain('↓99')

    // ↓99 只出现在详情栏里；清单表那一格仍然是 lean 的 ↓3
    const inList = screen.queryByText('↓99')
    expect(inList === null || inList.closest('table') === null).toBe(true)
  })

  it('「编辑资料」弹窗在整个应用里只有一个实例', async () => {
    server.use(
      http.get('/api/projects', () => HttpResponse.json({ projects: [project] })),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
      http.get('/api/status', () =>
        HttpResponse.json({ statuses: [{ projectId: 5, status: status({ behind: 0 }) }] }),
      ),
      http.get('/api/projects/5', () => HttpResponse.json({ project })),
      http.get('/api/projects/5/status', () =>
        HttpResponse.json({ status: status({ behind: 0, status: 'up_to_date' }) }),
      ),
    )

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <MemoryRouter initialEntries={['/projects/5']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // 清单行的「编辑资料」与详情栏的「编辑资料」是两个入口，点哪一个
    // 都必须落到同一个对话框上——而不是各开一个。
    // （两者的可访问名不一样：行内那个带项目名，详情栏那个就是按钮文字。）
    // 用 `waitFor` 等数量而不是 `findAllByRole`：后者一有第一个匹配就返回，
    // 清单比详情先渲染，拿到 1 个就跑了。
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /编辑资料/ })).toHaveLength(2)
    })

    const firstEdit = screen.getAllByRole('button', { name: /编辑资料/ })[0]
    firstEdit?.click()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})
