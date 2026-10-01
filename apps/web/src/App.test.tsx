import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'

/**
 * ErrorBoundary 接进 App 之后的行为。
 *
 * 单独测 ErrorBoundary 组件只能证明它自己能用；这条测的是**接线**：
 * 页面渲染抛错时，外壳（顶栏 / 侧栏）还得在，用户不能只看到白屏。
 *
 * 用 `vi.mock` 让项目详情页抛错来触发（它是最容易拿到意外数据的那个页面）。
 */

vi.mock('@/pages/ProjectDetailPage', () => ({
  ProjectDetailPage: () => {
    throw new Error('详情页炸了')
  },
}))

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

    // 顶栏品牌与主导航还在（说明崩的是内容区，不是整个应用）
    expect(screen.getByText('git-nest')).toBeTruthy()
    expect(screen.getByRole('link', { name: '清单' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: '设置' }).getAttribute('href')).toBe('/settings')
    // 降级界面自己也提供回清单的入口
    expect(screen.getAllByRole('link', { name: /清单/ }).length).toBeGreaterThan(0)
  })

  it('没崩的路由照常渲染', () => {
    renderApp('/settings')
    expect(screen.queryByText(/这一页崩了/)).toBeNull()
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
  })
})
