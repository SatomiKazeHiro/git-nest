import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IconPicker } from './IconPicker'

/**
 * 图标选择器：**触发控件 + 浮层**。
 *
 * ## 两条规矩（都是真问题逼出来的，不是洁癖）
 *
 * 1. **凡是在浮层里点东西，一律 `within(panel())`**。触发控件与网格项本来会同名
 *    （一个说"当前是打开的书"、一个说"可以选打开的书"）；现在触发控件的名字加了
 *    「当前图标：」前缀，但**撞名的可能永远存在**（比如占位文案与某一项同名）——
 *    限定范围既让查询说的是本意，也让它不会因为别处多一个按钮就红。
 * 2. **测的是行为，不是位置**。浮层是 portal 到 `document.body` 的 `position: fixed`，
 *    jsdom 没有布局引擎（`getBoundingClientRect()` 全 0、没有视口、没有真实滚动），
 *    所以"贴在下面""放不下往上翻""滚动时关掉"这里一律验不了，只能靠眼睛与真实浏览器。
 *    （能跑是因为 jsdom 返回的 `DOMRect` 是 truthy，浮层照样挂载。）
 */
function renderPicker(value: string | null = null) {
  const onChange = vi.fn()
  const view = render(<IconPicker value={value} onChange={onChange} />)
  return { ...view, onChange }
}

const trigger = () => screen.getByRole('button', { expanded: false })
const panel = () => screen.getByRole('dialog', { name: '选择图标' })
/** 浮层里的一个图标项。**只在这个范围内找**——外面那个是触发控件。 */
const iconIn = (name: string) => within(panel()).getByRole('button', { name })

describe('IconPicker · 触发控件', () => {
  it('显示当前选中的图标（视觉上是图标 + 中文名）', () => {
    renderPicker('book-open')
    const button = trigger()

    expect(button.textContent).toContain('打开的书')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('没有图标时显示占位，而不是空白', () => {
    renderPicker(null)

    expect(trigger().textContent).toContain('选择图标')
  })

  it('可访问名字与浮层里同名的那一项**不撞**（带「当前图标：」前缀）', () => {
    renderPicker('book-open')

    // 触发控件：说的是"现在的值"
    expect(screen.getByRole('button', { name: '当前图标：打开的书' })).toBeTruthy()
    // 浮层还没开，所以「打开的书」这个名字此刻不属于任何按钮
    expect(screen.queryByRole('button', { name: '打开的书' })).toBeNull()
  })

  it('`aria-expanded` 跟着开合走，并且指向浮层', () => {
    renderPicker()
    fireEvent.click(trigger())

    expect(screen.getByRole('button', { expanded: true }).getAttribute('aria-controls')).toBe(
      panel().id,
    )
  })
})

describe('IconPicker · 浮层', () => {
  it('点触发控件打开它，并且一开始列出全部图标', () => {
    renderPicker()
    fireEvent.click(trigger())

    expect(panel()).toBeTruthy()
    expect(within(panel()).getAllByRole('button').length).toBeGreaterThan(50)
  })

  it('选一项：回调它的 key，然后关掉浮层', () => {
    const { onChange } = renderPicker()
    fireEvent.click(trigger())
    fireEvent.click(iconIn('打开的书'))

    expect(onChange).toHaveBeenCalledWith('book-open')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('「不选图标」把它清成 null，然后关掉浮层', () => {
    const { onChange } = renderPicker('brain')
    fireEvent.click(trigger())
    fireEvent.click(iconIn('不选图标'))

    expect(onChange).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点已选中的那一项 = 取消选中（回调 null）', () => {
    const { onChange } = renderPicker('book-open')
    fireEvent.click(trigger())
    // **点的是浮层里那一项**，不是上面那个显示着同一个中文名的触发控件
    fireEvent.click(iconIn('打开的书'))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('**在浮层自己的网格里滚动：浮层还在**（滚着找图标时它不会把自己关掉）', () => {
    renderPicker()
    fireEvent.click(trigger())

    /*
      从浮层**内部**派发 scroll——这正是用户报的那个 bug：滚动监听挂在 document 的
      捕获阶段（为了让设置弹窗内容区的滚动也能收到），于是浮层自己网格里的滚动也被
      收到，用户正滚着找图标，浮层被自己关掉了。
      `scroll` 不冒泡，但**捕获阶段照样会经过祖先**，所以这里派的正是当时那一个事件。
      位置在 jsdom 里测不了（rect 全 0），所以这条只钉"还在"。
    */
    fireEvent.scroll(iconIn('打开的书'))

    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('**浮层外面滚动（设置弹窗内容区）：浮层还在**（重算位置，不关闭）', () => {
    renderPicker()
    fireEvent.click(trigger())

    fireEvent.scroll(document.body)

    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('窗口 resize：浮层还在', () => {
    renderPicker()
    fireEvent.click(trigger())

    fireEvent(window, new Event('resize'))

    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('Escape 关闭', () => {
    renderPicker()
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点浮层外面关闭；点浮层里面不关', () => {
    renderPicker()
    fireEvent.click(trigger())
    fireEvent.mouseDown(panel())
    expect(screen.queryByRole('dialog')).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('再点一次触发控件把它收起来（同一个按钮管开也管关）', () => {
    renderPicker()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { expanded: true }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('IconPicker · 搜索（沿用）', () => {
  /** 打开浮层并搜一个词。之后**一切都只在浮层里查**。 */
  const search = (q: string) => {
    renderPicker()
    fireEvent.click(trigger())
    fireEvent.change(screen.getByLabelText('搜索图标'), { target: { value: q } })
  }

  it('按中文名筛', () => {
    search('打开的书')
    expect(iconIn('打开的书')).toBeTruthy()
    expect(within(panel()).queryByRole('button', { name: '扳手' })).toBeNull()
  })

  it('按英文 key 筛，且不区分大小写', () => {
    search('BOOK-OPEN')
    expect(iconIn('打开的书')).toBeTruthy()
  })

  it('按中文关键词筛（用户不知道图标叫什么）', () => {
    search('知识库')
    expect(iconIn('打开的书')).toBeTruthy()
  })

  it('清空查询回到全部', () => {
    search('打开的书')
    const filtered = within(panel()).getAllByRole('button').length
    fireEvent.change(screen.getByLabelText('搜索图标'), { target: { value: '' } })

    expect(within(panel()).getAllByRole('button').length).toBeGreaterThan(filtered)
  })

  it('搜不到时给一句话，不给空网格', () => {
    search('zzzzz')
    expect(screen.getByText(/没有匹配的图标/)).toBeTruthy()
  })

  it('按钮的可访问名字是中文名，不是 key', () => {
    search('book')
    expect(within(panel()).queryByRole('button', { name: 'book-open' })).toBeNull()
    expect(iconIn('打开的书')).toBeTruthy()
  })
})
