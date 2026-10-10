import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Toolbar } from './ListToolbar'
import { useUiStore } from '@/store/ui'

/**
 * 工具条上那枚「设置」按钮的接线。
 *
 * 它必须**打开设置弹窗**，而不是跳路由——`/settings` 那条路由已经删了，
 * 没有任何页面可跳。同时它得在「添加项目」右侧（用户是这么要求的）。
 */
beforeEach(() => {
  useUiStore.setState({ settingsOpen: false })
})

function renderToolbar() {
  return render(<Toolbar total={3} onCheckUpdates={() => {}} onScan={() => {}} />)
}

describe('工具条', () => {
  it('「设置」点一下就把设置弹窗打开', () => {
    renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })

  it('它是这一行最右边的那一枚（在「添加项目」右侧）', () => {
    renderToolbar()
    const buttons = screen.getAllByRole('button')
    expect(buttons[buttons.length - 1]?.textContent).toContain('设置')
    expect(buttons[buttons.length - 2]?.textContent).toContain('添加项目')
  })
})
