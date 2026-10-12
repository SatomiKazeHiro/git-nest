import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IconPicker } from './IconPicker'

/**
 * 图标选择器。
 *
 * 三件事是它的全部职责：**搜得到**（94 个图标靠翻是找不到的）、**选得中**、
 * **清得掉**（图标是可选的）。所以这里逐条钉住，包括"清空查询回到全部"与
 * "点已选中的那一项 = 取消选中"这两个容易漏的边界。
 */
function renderPicker(value: string | null = null) {
  const onChange = vi.fn()
  const view = render(<IconPicker value={value} onChange={onChange} />)
  return { ...view, onChange }
}

const searchBox = () => screen.getByLabelText('搜索图标')

describe('IconPicker', () => {
  it('一开始列出全部图标', () => {
    const { container } = renderPicker()
    // 每个图标一个按钮；「不设图标」与搜索框不是网格里的
    expect(container.querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(50)
  })

  it('输入中文名能筛出对应那一项', () => {
    renderPicker()
    fireEvent.change(searchBox(), { target: { value: '打开的书' } })

    expect(screen.getByRole('button', { name: '打开的书' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '扳手' })).toBeNull()
  })

  it('输入英文 key 也能筛出来（不区分大小写）', () => {
    renderPicker()
    fireEvent.change(searchBox(), { target: { value: 'BOOK-OPEN' } })

    expect(screen.getByRole('button', { name: '打开的书' })).toBeTruthy()
  })

  it('按中文关键词也能筛（用户不知道图标叫什么）', () => {
    renderPicker()
    fireEvent.change(searchBox(), { target: { value: '知识库' } })

    expect(screen.getByRole('button', { name: '打开的书' })).toBeTruthy()
  })

  it('清空查询回到全部', () => {
    const { container } = renderPicker()
    fireEvent.change(searchBox(), { target: { value: '打开的书' } })
    const filtered = container.querySelectorAll('button[aria-pressed]').length

    fireEvent.change(searchBox(), { target: { value: '' } })

    expect(container.querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(filtered)
  })

  it('搜不到时给一句话，不给空网格', () => {
    renderPicker()
    fireEvent.change(searchBox(), { target: { value: 'zzzzz' } })

    expect(screen.getByText(/没有匹配的图标/)).toBeTruthy()
  })

  it('点一项把它的 key 回调出去', () => {
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: '打开的书' }))

    expect(onChange).toHaveBeenCalledWith('book-open')
  })

  it('点已选中的那一项 = 取消选中（回调 null）', () => {
    const { onChange } = renderPicker('book-open')
    fireEvent.click(screen.getByRole('button', { name: '打开的书' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('「不设图标」把它清成 null；当前没有图标时它是禁用的', () => {
    const { onChange } = renderPicker('brain')
    fireEvent.click(screen.getByRole('button', { name: '不设图标' }))
    expect(onChange).toHaveBeenCalledWith(null)

    /*
      必须 `within(none.container)`：同一个测试里前一个选择器还挂在 DOM 上，直接
      `getAllByRole(...)[0]` 取到的是**它**的按钮（value 是 'brain'，当然不 disabled）
      ——上一版就是这么红的：**测错了对象，不是组件错了**。组件那边 `disabled` 的判据
      是 `value === null`（IconPicker.tsx 里那一行），传 null 就该禁用，断言不动。
    */
    const none = renderPicker(null)
    const button = within(none.container).getByRole('button', { name: '不设图标' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(none.onChange).not.toHaveBeenCalled()
  })

  it('按钮的可访问名字是中文名，不是 key', () => {
    renderPicker()
    expect(screen.queryByRole('button', { name: 'book-open' })).toBeNull()
  })
})
