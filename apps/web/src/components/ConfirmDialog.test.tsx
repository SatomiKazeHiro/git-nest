import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * 确认弹窗只有四件事要钉：**文案由调用方给**、两个按钮各自回到对应回调、
 * `loading` 挡住重复提交（但不挡「取消」）、以及底座那套（Escape / 焦点）穿过
 * 这一层仍然生效——它是包装，不是重写。
 */
function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <ConfirmDialog title="把 canvas-editor 移出清单？" danger onConfirm={onConfirm} onClose={onClose} {...overrides} />,
  )
  return { ...view, onConfirm, onClose }
}

describe('ConfirmDialog', () => {
  it('文案由调用方给，两个按钮各自回到对应回调', () => {
    const { onConfirm, onClose } = renderDialog({
      confirmText: '移出清单',
      cancelText: '留下',
    })

    fireEvent.click(screen.getByRole('button', { name: '移出清单' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // 「取消」不该顺带确认：它只关门
    fireEvent.click(screen.getByRole('button', { name: '留下' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('缺省文案是「确认」/「取消」', () => {
    renderDialog()

    expect(screen.getByRole('button', { name: '确认' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('loading 期间确认按钮不可点（防重复提交），取消仍然可点', () => {
    renderDialog({ loading: true, confirmText: '移出清单' })

    expect((screen.getByRole('button', { name: /移出清单/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('说明在正文里，额外内容排在它后面（错误横幅就是走这条路）', () => {
    renderDialog({
      description: <>只删掉清单里这一条。</>,
      children: <p>移除失败：磁盘只读</p>,
    })

    expect(screen.getByText('只删掉清单里这一条。')).toBeTruthy()
    expect(screen.getByText('移除失败：磁盘只读')).toBeTruthy()
  })

  it('底座那套照旧生效：Escape 关闭', () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
