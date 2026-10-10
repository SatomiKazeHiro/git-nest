import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Dialog } from './Dialog'

/**
 * 通用弹窗**自己该管**的那几件事。
 *
 * 它们以前散在各处、各有各的缺法：自制的那版没有 Escape、没有初始焦点、
 * 也不圈焦点——键盘用户 Tab 一下就跑到底下的清单里去了，而屏幕上没有任何
 * 东西提示过这件事。
 *
 * 这一层不认识任何业务，所以这里也不装业务：只拿几个按钮和输入框当内容。
 */

describe('Dialog · 关闭', () => {
  it('Escape 关闭', () => {
    const close = vi.fn()
    render(
      <Dialog title="标题" onClose={close}>
        <input aria-label="字段" />
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('点遮罩关闭；点弹窗里面不关', () => {
    const close = vi.fn()
    render(
      <Dialog title="标题" onClose={close}>
        <p>正文</p>
      </Dialog>,
    )
    const panel = screen.getByRole('dialog')
    const mask = panel.parentElement as HTMLElement

    fireEvent.mouseDown(panel)
    expect(close, '点在面板里不该关').not.toHaveBeenCalled()

    fireEvent.mouseDown(mask)
    expect(close, '点在遮罩上该关').toHaveBeenCalledTimes(1)
  })
})

describe('Dialog · 焦点', () => {
  it('初始焦点落在内容区第一个输入框，而不是头部那枚关闭按钮', () => {
    render(
      <Dialog title="标题" onClose={() => {}}>
        <input aria-label="第一个字段" />
        <input aria-label="第二个字段" />
      </Dialog>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('第一个字段'))
  })

  it('Tab 圈在弹窗里：最后一个 Tab 回第一个', () => {
    render(
      <Dialog title="标题" onClose={() => {}}>
        <input aria-label="字段" />
      </Dialog>,
    )
    const closeButton = screen.getByRole('button', { name: '关闭' })
    const last = screen.getByLabelText('字段')

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)
  })

  it('Shift+Tab 反向：第一个回到最后一个', () => {
    render(
      <Dialog title="标题" onClose={() => {}}>
        <input aria-label="字段" />
      </Dialog>,
    )
    const closeButton = screen.getByRole('button', { name: '关闭' })
    const last = screen.getByLabelText('字段')

    closeButton.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('关闭之后焦点还给打开它的那个控件（不掉到 body 上）', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>打开</button>
          {open ? (
            <Dialog title="标题" onClose={() => setOpen(false)}>
              <input aria-label="字段" />
            </Dialog>
          ) : null}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByLabelText('字段'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })
})

describe('Dialog · 嵌套', () => {
  it('两个叠着时，Escape 只关最上面那个', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    render(
      <Dialog title="外层" onClose={closeOuter}>
        <button>外层按钮</button>
        <Dialog title="内层" onClose={closeInner}>
          <button>内层按钮</button>
        </Dialog>
      </Dialog>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeInner, '内层该关').toHaveBeenCalledTimes(1)
    expect(closeOuter, '外层不该跟着一起关').not.toHaveBeenCalled()
  })
})

describe('Dialog · 无障碍与槽', () => {
  it('可访问名来自那个可见的标题（不是另写一份 aria-label）', () => {
    render(
      <Dialog title="移出清单" description="只删记录，不动磁盘" onClose={() => {}}>
        <p>正文</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: '移出清单' })
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toBe('只删记录，不动磁盘')
  })

  it('footer 是底部固定的一条，不在会滚的内容区里', () => {
    render(
      <Dialog title="标题" footer={<button>确定</button>} onClose={() => {}}>
        <p>正文</p>
      </Dialog>,
    )
    expect(screen.getByRole('button', { name: '确定' }).closest('footer')).not.toBeNull()
    expect(screen.getByText('正文').closest('footer')).toBeNull()
  })
})
