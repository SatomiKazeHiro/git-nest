import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { Toolbar } from './ListToolbar'
import { useUiStore } from '@/store/ui'

/**
 * 工具条上的接线：
 *
 * - 「设置」必须**打开设置弹窗**，而不是跳路由——`/settings` 那条路由已经删了，
 *   没有任何页面可跳。同时它得在「添加项目」右侧（用户是这么要求的）；
 * - 「刷新」必须真的打 `POST /api/auto-fetch`，并把结果说出来（成功几个、跳过几个）。
 *   **失败时不许沉默**：刷新失败却显示「好了」是最坏的一种反馈。
 */
beforeEach(() => {
  useUiStore.setState({ settingsOpen: false })
})

/** 刷新按钮用了 react-query（mutation），所以要给它一个 client */
function renderToolbar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toolbar total={3} onScan={() => {}} />
    </QueryClientProvider>,
  )
}

describe('工具条', () => {
  it('「设置」点一下就把设置弹窗打开', () => {
    renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })

  it('「设置」在这一行最右；「添加项目」在动作组里、刷新左边', () => {
    renderToolbar()
    const settings = screen.getByRole('button', { name: /设置/ })
    const add = screen.getByRole('button', { name: /添加项目/ })
    const refresh = screen.getByRole('button', { name: /^刷新$/ })
    const buttons = screen.getAllByRole('button')
    expect(buttons[buttons.length - 1]).toBe(settings)
    // 纯图标按钮没有文字，这里钉的是**位置**：添加 → … → 刷新 →（其余）→ 设置
    expect(add.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(refresh.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('「刷新」联网跑一轮，并把结果说出来', async () => {
    let calls = 0
    server.use(
      http.post('/api/auto-fetch', () => {
        calls += 1
        return HttpResponse.json({
          summary: { at: new Date().toISOString(), projects: 3, checked: 2, skipped: 1, failed: 0 },
        })
      }),
    )

    renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }))

    await waitFor(() => expect(screen.getByText(/已刷新 2 个/)).toBeTruthy())
    // 跳过的那几个也说清楚（自己的项目默认不联网，不说用户会以为漏了）
    expect(screen.getByText(/跳过 1 个/)).toBeTruthy()
    expect(calls).toBe(1)
  })

  it('刷新失败时不沉默（把后端那句话摆出来）', async () => {
    server.use(
      http.post('/api/auto-fetch', () =>
        HttpResponse.json({ message: '连不上后端，确认 apps/server 还在跑' }, { status: 500 }),
      ),
    )

    renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain('连不上后端')
  })
})
