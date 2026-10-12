import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FilterToggle } from './FilterToggle'
import { useUiStore } from '@/store/ui'

/**
 * 过滤面板的收起开关（贴在面板右缘的半胶囊）。
 *
 * 两条要钉住的：
 * 1. **收起之后它自己还得在**——否则抽屉关上了就再也打不开；
 * 2. **有筛选时要说出来**。面板一收起，那几段高亮就全看不见了，
 *    这枚开关上的圆点是唯一还能提示「表里现在不是全部」的东西。
 */
beforeEach(() => {
  useUiStore.getState().clearFilters()
  useUiStore.setState({ filterPanelOpen: true })
})

describe('过滤面板的收起开关', () => {
  it('点一下收起、再点一下展开；方向由 aria-expanded 与名字一起表达', () => {
    render(<FilterToggle />)

    const collapse = screen.getByRole('button', { name: '收起过滤面板' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(collapse)
    expect(useUiStore.getState().filterPanelOpen).toBe(false)

    const expand = screen.getByRole('button', { name: '展开过滤面板' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)
    expect(useUiStore.getState().filterPanelOpen).toBe(true)
  })

  it('有筛选时 title 里说清「还筛着东西」——收起后这是唯一的可见线索', () => {
    useUiStore.setState((s) => ({ filters: { ...s.filters, q: 'abc' } }))
    render(<FilterToggle />)

    expect(screen.getByRole('button').getAttribute('title')).toContain('有筛选')
  })

  it('没有筛选时 title 不提这茬（别把常态说成异常）', () => {
    render(<FilterToggle />)

    expect(screen.getByRole('button').getAttribute('title')).not.toContain('有筛选')
  })

  it('角标：有筛选时按钮上有一枚圆点，没有筛选时没有', () => {
    /*
      两个方向都要钉住：只测「有」的话，一个永远画着圆点的实现也能过。
      位置（在搜索框左边、不压表格）jsdom 看不到——那是眼睛的事。
    */
    const without = render(<FilterToggle />)
    expect(without.container.querySelector('.filter-toggle-dot')).toBeNull()
    without.unmount()

    useUiStore.setState((s) => ({ filters: { ...s.filters, q: 'abc' } }))
    const withFilter = render(<FilterToggle />)
    expect(withFilter.container.querySelector('.filter-toggle-dot')).toBeTruthy()
  })
})
