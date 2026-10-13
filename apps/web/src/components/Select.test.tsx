import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Folder } from 'lucide-react'
import { Select, type SelectOption } from './Select'

/**
 * 共用下拉（`Select`）。
 *
 * 这个组件的形态是**自己画的**（原生 `<option>` 里画不了图标），于是它也自己承担了
 * 原生控件白送的那些事：开合、键盘、焦点、点外面。所以这里逐条钉住——尤其是
 * **Escape 不许漏给外面**：调用方常常把它放在弹窗里，弹窗自己也在 document 上听着
 * Escape，漏下去就是「按一下，两个一起关」。
 *
 * 还有一条是上一版原生下拉踩出来的：**空值只能有一份表示**。当时「未分类」那枚固定
 * 选项之外，兜底那一支又给空值画了第二枚 `value=''` 的选项，用户看到的是
 * 「未分类」下面挂着一个**没有文字**的空白项。这里把它钉成两条：浮层里没有空名字的
 * 选项；「清空」只由那枚 × 承担。
 */

const OPTIONS: SelectOption[] = [
  { value: '', label: '未分类' },
  { value: 'tools', label: '工具', icon: <Folder size={14} aria-hidden /> },
  { value: 'knowledge-base', label: '知识库' },
]

/**
 * 这一格的触发控件。**按可访问名字找**（`aria-label`），不是按可见文字——
 * 可见文字是「现在选的是哪个」，它跟着值变；名字说的是「这一格是什么」，它不变。
 * 这两件事分清楚，读屏用户才听得到「分类」这层身份。
 */
function triggerButton() {
  return screen.getByRole('button', { name: '分类' })
}

function renderSelect(props: Partial<Parameters<typeof Select>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <Select
      aria-label="分类"
      options={OPTIONS}
      value="tools"
      onChange={onChange}
      clearable
      {...props}
    />,
  )
  return { onChange }
}

/** 受控用法：真的把值存在 state 里，才看得见「选完控件上换了什么」。 */
function Controlled({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <Select
      aria-label="分类"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      clearable
      placeholder="未分类"
    />
  )
}

describe('Select · 开合', () => {
  it('关着的时候只有一个触发控件：`aria-haspopup` / `aria-expanded=false`，没有列表', () => {
    renderSelect()

    const trigger = triggerButton()
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    /*
      可访问名字说的是「这一格是什么」，不是「现在选的是哪个」：`aria-label` 优先于
      可见文字，把当前值写进名字里去的话，读屏每选一次都会听到一个**变了名字**的按钮。
    */
    expect(trigger.getAttribute('aria-label')).toBe('分类')
    expect(trigger.textContent).toContain('工具')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('点一下打开：`aria-expanded=true`、列表出现、`aria-controls` 指得着它', () => {
    renderSelect()
    const trigger = triggerButton()

    fireEvent.click(trigger)

    const list = screen.getByRole('listbox', { name: '分类' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(list.getAttribute('id'))
    // 选项都在
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '未分类',
      '工具',
      '知识库',
    ])
  })

  it('再点一下触发控件就关掉（第四条关闭路径）', () => {
    renderSelect()
    const trigger = triggerButton()

    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('点外面关掉（浮层挂在 body 上，点别处不该留着它）', async () => {
    renderSelect()
    fireEvent.click(triggerButton())
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.mouseDown(document.body)

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })
})

describe('Select · 选中与清空', () => {
  it('点某一项：回调收到它的 `value`，浮层关掉，焦点回到触发控件', async () => {
    const { onChange } = renderSelect()
    const trigger = triggerButton()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: '知识库' }))

    expect(onChange).toHaveBeenCalledWith('knowledge-base')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('选中项：只有它带 `aria-selected=true`', () => {
    renderSelect()
    fireEvent.click(triggerButton())

    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected.map((o) => o.textContent)).toEqual(['工具'])
  })

  it('× 清空：回调收到空串（＝「未分类」），且**不会**顺手把浮层打开', () => {
    const { onChange } = renderSelect()

    fireEvent.click(screen.getByLabelText('清空分类'))

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('没选中时不画 ×：没有东西可清，摆一枚没用的控件比没有更糟', () => {
    renderSelect({ value: '' })
    expect(screen.queryByLabelText('清空分类')).toBeNull()
  })

  it('`clearable` 关掉时永远不画 ×（排序那类「清空」没有意义的用法）', () => {
    renderSelect({ clearable: false })
    expect(screen.queryByLabelText('清空分类')).toBeNull()
  })
})

describe('Select · 键盘', () => {
  it('打开时焦点进列表，高亮从**当前选中项**开始，上下键在名单里绕圈', async () => {
    renderSelect()
    fireEvent.click(triggerButton())

    const list = screen.getByRole('listbox')
    await waitFor(() => expect(document.activeElement).toBe(list))

    const highlighted = () =>
      screen.getAllByRole('option').filter((o) => o.hasAttribute('data-highlighted'))
    expect(highlighted().map((o) => o.textContent)).toEqual(['工具'])

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(highlighted().map((o) => o.textContent)).toEqual(['知识库'])

    // 到底了再往下：绕回第一项（不是卡住不动）
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(highlighted().map((o) => o.textContent)).toEqual(['未分类'])

    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(highlighted().map((o) => o.textContent)).toEqual(['知识库'])
  })

  it('上下键会 `preventDefault`：不拦浏览器就拿它滚页面', () => {
    renderSelect()
    fireEvent.click(triggerButton())
    const list = screen.getByRole('listbox')

    // fireEvent 返回 false 就是 defaultPrevented
    expect(fireEvent.keyDown(list, { key: 'ArrowDown' })).toBe(false)
  })

  it('Enter 选中高亮那一项', () => {
    const { onChange } = renderSelect()
    fireEvent.click(triggerButton())
    const list = screen.getByRole('listbox')

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('knowledge-base')
  })

  it('Escape 关掉，焦点回到触发控件，**并且不把 Escape 漏给外面**', async () => {
    /*
      漏出去会连带关掉外面的东西：这个组件常用在弹窗里，弹窗自己也在 document 上
      听着 Escape（`Dialog`）。所以这里连「有没有冒泡到 document」一起钉住。
    */
    renderSelect()
    const trigger = triggerButton()
    fireEvent.click(trigger)

    let leaked = false
    const spy = () => {
      leaked = true
    }
    document.addEventListener('keydown', spy)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    document.removeEventListener('keydown', spy)
    expect(leaked).toBe(false)

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('焦点在触发控件上按 Escape 也关（且同样不漏给外面）', async () => {
    renderSelect()
    const trigger = triggerButton()
    fireEvent.click(trigger)

    let leaked = false
    const spy = () => {
      leaked = true
    }
    document.addEventListener('keydown', spy)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    document.removeEventListener('keydown', spy)

    expect(leaked).toBe(false)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })
})

describe('Select · 空值、占位与图标', () => {
  it('空值时触发控件显示 `placeholder`，不是一片空白', () => {
    renderSelect({ value: '', placeholder: '未分类' })
    expect(triggerButton().textContent).toContain('未分类')
  })

  it('`undefined` 和空串是同一件事：都算没选中', () => {
    renderSelect({ value: undefined, placeholder: '未分类' })
    expect(triggerButton().textContent).toContain('未分类')
    expect(screen.queryByLabelText('清空分类')).toBeNull()
  })

  it('浮层里的「未分类」那一项**有名字**，周围没有空名字的项', () => {
    /*
      这就是上一版那个空白项的用例：空值那一格必须是一个**有名有姓**的选项，
      而它只该出现一次。多出来的空名字选项，用户看到的就是「未分类」下面一个空白。
    */
    renderSelect({ value: '' })
    fireEvent.click(triggerButton())

    const labels = screen.getAllByRole('option').map((o) => o.textContent?.trim() ?? '')
    expect(labels).toEqual(['未分类', '工具', '知识库'])
    expect(screen.getAllByRole('option', { name: '未分类' })).toHaveLength(1)
  })

  it('选「未分类」那一项 → 报出去的是空串', () => {
    const { onChange } = renderSelect({ value: 'knowledge-base' })
    fireEvent.click(triggerButton())
    fireEvent.click(screen.getByRole('option', { name: '未分类' }))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('图标：选中项的图标在触发控件上，每一项的图标在自己的选项里', () => {
    const { container } = render(
      <Select aria-label="分类" options={OPTIONS} value="tools" onChange={() => {}} />,
    )
    // 触发控件：当前这一项有图标
    expect(container.querySelector('button[aria-haspopup="listbox"] svg')).not.toBeNull()

    fireEvent.click(triggerButton())
    const tools = screen.getByRole('option', { name: '工具' })
    expect(tools.querySelector('svg')).not.toBeNull()
    // 没给图标的那一项不塞占位图
    expect(screen.getByRole('option', { name: '知识库' }).querySelector('svg')).toBeNull()
  })
})

describe('Select · 受控用法', () => {
  it('选完控件上换成了那一项的文字（值不是组件自己留着的）', () => {
    render(<Controlled />)
    expect(triggerButton().textContent).toContain('未分类')

    fireEvent.click(triggerButton())
    fireEvent.click(screen.getByRole('option', { name: '知识库' }))

    expect(triggerButton().textContent).toContain('知识库')
    expect(triggerButton().textContent).not.toContain('未分类')
  })

  it('清空之后回到占位', () => {
    render(<Controlled initial="tools" />)
    expect(triggerButton().textContent).toContain('工具')

    fireEvent.click(screen.getByLabelText('清空分类'))

    expect(triggerButton().textContent).toContain('未分类')
  })
})
