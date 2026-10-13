import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('Select · 这一块的内部次序', () => {
  it('DOM 次序是 `[文字] … [×] [v]`：× 在 v **之前**，v 在不带 × 时也还在最右边', () => {
    /*
      用户报过「× 跑到 v 右边去了」。次序是能测的，就不用靠眼睛看：
      把这一块里的节点按**文档次序**走一遍，看先遇到哪一个。

      不用 `compareDocumentPosition` 的位掩码：那一位在 jsdom + 这层转换下算出来一直
      是 0（同一个节点才该是 0），拿它断言会永远绿/永远红——判据本身不可信，就别用它。
    */
    const { container, rerender } = render(
      <Select aria-label="分类" options={OPTIONS} value="tools" onChange={() => {}} clearable />,
    )
    const controlOf = () => container.firstElementChild as HTMLElement
    const chevron = () => container.querySelector('.lucide-chevron-down')

    /** 这一块里按文档次序排好的元素，取其中两个的先后 */
    function documentOrder(root: HTMLElement): Element[] {
      const out: Element[] = []
      const walk = (node: Node) => {
        if (node instanceof Element) out.push(node)
        node.childNodes.forEach(walk)
      }
      walk(root)
      return out
    }

    const order = documentOrder(controlOf())
    const clear = container.querySelector('button[aria-label="清空分类"]')
    const v = chevron()
    expect(clear).not.toBeNull()
    expect(v).not.toBeNull()
    expect(order.indexOf(clear!)).toBeGreaterThan(-1)
    // v 排在 × **后面**
    expect(order.indexOf(v!)).toBeGreaterThan(order.indexOf(clear!))

    // × 不画（没有值）时，v 依然在最右边那一格
    rerender(<Select aria-label="分类" options={OPTIONS} value="" onChange={() => {}} clearable />)
    expect(container.querySelector('button[aria-label="清空分类"]')).toBeNull()
    expect(chevron()).not.toBeNull()
  })

  it('v 只是装饰（自己不带点击），点它左边那块＝**一次**点击就打开、再点一次才关', () => {
    /*
      v 如果单独接一个 `onClick`，一次点击会命中它和它左边那层按钮两次，等于没反应。
      所以这里钉两件事：v 上没有绑定点击；那一片区域的交互仍然只是「一次点击 = 开，
      再一次 = 关」。v 是画在控件最右边的纯装饰，不接任何事件。
    */
    renderSelect()
    const v = document.querySelector('.lucide-chevron-down')
    expect(v).not.toBeNull()
    expect(v!.getAttribute('role')).toBeNull()
    expect(v!.closest('button')).toBeNull()

    // 点它左边那块（触发按钮）——用户点 v 那一片命中的就是这里
    fireEvent.click(triggerButton())
    expect(screen.getByRole('listbox', { name: '分类' })).toBeTruthy()

    fireEvent.click(triggerButton())
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('Select · 浮层与控件对齐', () => {
  /** 控件的矩形。列宽 224 正是弹窗里那一格（`w-56`）的量级 */
  const CONTROL = { left: 100, top: 80, width: 224, height: 28 }
  const rect = (): DOMRect => ({
    x: CONTROL.left,
    y: CONTROL.top,
    top: CONTROL.top,
    bottom: CONTROL.top + CONTROL.height,
    left: CONTROL.left,
    right: CONTROL.left + CONTROL.width,
    width: CONTROL.width,
    height: CONTROL.height,
    toJSON: () => ({}),
  })

  /** 窗口大小也一起打桩：向上还是向下翻由它算出来 */
  function stubLayout(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(rect)
  }

  function panel() {
    return screen.getByRole('listbox', { name: '分类' })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('左边缘与宽度都对齐**有边框的整块**（不是里面那枚按钮）', async () => {
    /*
      jsdom 不做排版，`getBoundingClientRect` 全是 0——所以这里给它打桩。
      打桩之后「面板与控件对齐」这件事就是可测的，不必只靠眼睛。
    */
    stubLayout(1280, 800)
    const { container } = render(
      <Select aria-label="分类" options={OPTIONS} value="tools" onChange={() => {}} clearable />,
    )
    // 打桩的是**整块**那个有边框的元素（`aria-haspopup` 是里面那枚按钮，不是它）
    const control = container.firstElementChild as HTMLElement
    expect(control.getBoundingClientRect().width).toBe(CONTROL.width)

    fireEvent.click(triggerButton())
    const list = panel()

    expect(list.style.position).toBe('fixed')
    expect(list.style.left).toBe(`${CONTROL.left}px`)
    // 不比控件窄；对齐比的是**左边缘**，宽度只许更宽（选项文字长时读得全）
    expect(parseFloat(list.style.width)).toBeGreaterThanOrEqual(CONTROL.width)
    // 往下放：贴在控件下边缘 + 4px
    expect(list.style.top).toBe(`${CONTROL.top + CONTROL.height + 4}px`)
    expect(list.style.bottom).toBe('')
  })

  it('下面放不下就向上翻：只改上下（`bottom` 生效），**左右一个像素都不动**', () => {
    stubLayout(1280, 120) // 控件底下只剩 12px
    render(<Select aria-label="分类" options={OPTIONS} value="tools" onChange={() => {}} clearable />)

    fireEvent.click(triggerButton())
    const list = panel()

    expect(list.style.top).toBe('')
    expect(list.style.bottom).toBe(`${120 - CONTROL.top + 4}px`)
    // 横向与不翻的那一支完全一致
    expect(list.style.left).toBe(`${CONTROL.left}px`)
    expect(parseFloat(list.style.width)).toBeGreaterThanOrEqual(CONTROL.width)
  })
})
