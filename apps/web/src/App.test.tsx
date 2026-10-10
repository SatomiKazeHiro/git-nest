import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/mocks/server'
import { App } from './App'

/**
 * ErrorBoundary 接进 App 之后的行为。
 *
 * 单独测 ErrorBoundary 组件只能证明它自己能用；这条测的是**接线**：
 * 页面渲染抛错时，外壳（标题栏）还得在，用户不能只看到白屏。
 *
 * 用 `vi.mock` 让项目详情页抛错来触发（它是最容易拿到意外数据的那个页面）。
 */

vi.mock('@/pages/ProjectDetailPage', () => ({
  ProjectDetailPage: () => {
    throw new Error('详情页炸了')
  },
}))

/**
 * 「编辑资料」弹窗挂在组合根上（`App.tsx`），整个应用只此一份；它在
 * `ErrorBoundary` 之外，所以页面炸了它也还在。它无条件拉一次标签列表。
 *
 * 不 mock 的话 msw 会报「拦截到没有 handler 的请求」——而这个报错**不一定
 * 让用例变红**（查询失败被 react-query 吞掉，测试可能已经结束了）。
 * 也就是说过日子它会变成一条「测试通过但压根没打到接口」的假绿，
 * 而这里恰恰要证明的是外壳的接线。加一条空的标签列表把这条路堵上。
 */
beforeEach(() => {
  server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [] })))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App 的异常兜底', () => {
  it('页面抛错时给出降级界面，而不是白屏', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderApp('/projects/1')

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/这一页崩了/)).toBeTruthy()
    expect(screen.getByText(/详情页炸了/)).toBeTruthy()
  })

  it('外壳还在：顶栏仍然可用，回得去清单', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderApp('/projects/1')

    // 标题栏还在（说明崩的是内容区，不是整个应用）
    expect(screen.getByText('git-nest')).toBeTruthy()
    // 降级界面自己也提供回清单的入口
    expect(screen.getAllByRole('link', { name: /清单/ }).length).toBeGreaterThan(0)
  })

  it('没崩的路由照常渲染', () => {
    renderApp('/settings')
    expect(screen.queryByText(/这一页崩了/)).toBeNull()
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
  })
})
