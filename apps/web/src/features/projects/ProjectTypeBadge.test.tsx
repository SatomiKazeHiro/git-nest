import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

/*
  `docs/types/` 里有没有那张图是**使用者自己填的**（现在很可能是空的），
  所以这里把「查图标」那一层换成可控的：要测的是**角标本身的几何**，
  不是文件系统里有没有文件。
*/
vi.mock('./typeIcons', () => ({
  typeIconUrl: (type: string | null) => (type === 'vue' ? 'data:image/svg+xml,<svg/>' : null),
}))

const { ProjectTypeBadge } = await import('./ProjectTypeBadge')

/**
 * 角标的视觉规格：**16×16 白圆 + 12×12 图标**，压在默认图的右下角。
 *
 * 这三条都要钉住，因为它们各自有一个具体的坏法：圆小了图标糊、图标大了出框、
 * 不出格就盖掉文件夹右下角一块。
 */
describe('ProjectTypeBadge', () => {
  it('16×16 白圆，里面 12×12 图标', () => {
    const { container } = render(<ProjectTypeBadge type="vue" />)
    const circle = container.querySelector('span')
    const icon = circle?.querySelector('img')

    expect(circle?.style.width).toBe('16px')
    expect(circle?.style.height).toBe('16px')
    expect(icon?.style.width).toBe('12px')
    expect(icon?.style.height).toBe('12px')
  })

  it('白圆底由界面提供（图标是纯形状，没有自带底）', () => {
    const { container } = render(<ProjectTypeBadge type="vue" />)
    const circle = container.querySelector('span')

    expect(circle?.className).toContain('bg-white')
    expect(circle?.className).toContain('rounded-full')
  })

  it('压在右下角，且略微出格 1px（塞进框里会盖掉文件夹一块）', () => {
    const { container } = render(<ProjectTypeBadge type="vue" />)
    const className = container.querySelector('span')?.className ?? ''

    expect(className).toContain('absolute')
    expect(className).toContain('-bottom-px')
    expect(className).toContain('-right-px')
  })

  it('认不出类型 → 什么都不画（不留空圈）', () => {
    const { container } = render(<ProjectTypeBadge type={null} />)
    expect(container.querySelector('span')).toBeNull()
  })

  it('还没收集到那张图标 → 也什么都不画', () => {
    const { container } = render(<ProjectTypeBadge type="cobol" />)
    expect(container.querySelector('span')).toBeNull()
  })

  it('图标加载失败 → 整个消失，不留一个空圆', () => {
    const { container } = render(<ProjectTypeBadge type="vue" />)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('span')).toBeNull()
  })
})
