import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { useUiStore } from '@/store/ui'
import { ScanDialog } from './ScanDialog'

/**
 * 扫描从设置里搬出来之后的两条接线。
 *
 * 它钉的是**入口与容器**：开关是 store 上一个独立的标志（`scanOpen`，不再借用
 * `settingsOpen`），内容仍然是原来那一段 `ScanSection`（所以这里用一个只有它才有的
 * 字段当证据——「往下扫几层」）。
 */
function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScanDialog />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useUiStore.setState({ scanOpen: false, settingsOpen: false })
})

describe('扫描目录弹窗', () => {
  it('关着的时候什么都不渲染', () => {
    const { container } = renderDialog()
    expect(container.firstChild).toBeNull()
  })

  it('打开时是一个叫「扫描目录」的弹窗，里面就是原来那段扫描', () => {
    useUiStore.setState({ scanOpen: true })
    renderDialog()

    expect(screen.getByRole('dialog', { name: '扫描目录' })).toBeTruthy()
    // 「往下扫几层」只有扫描那一段有——用它证明装的确实是 ScanSection，而不是空壳
    expect(screen.getByLabelText('往下扫几层')).toBeTruthy()
  })

  it('它和设置是**两个独立的开关**：开扫描不会顺手把设置也打开', () => {
    useUiStore.setState({ scanOpen: true })
    renderDialog()

    expect(useUiStore.getState().settingsOpen).toBe(false)
  })
})
