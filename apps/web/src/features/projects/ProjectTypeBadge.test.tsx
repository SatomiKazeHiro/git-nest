import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

/*
  `assets/types/` 里有没有那张图是**使用者自己填的**（现在很可能是空的），
  所以这里把「查图标」那一层换成可控的：要测的是**角标本身的几何**，
  不是文件系统里有没有文件。
*/
vi.mock('./typeIcons', () => ({
  typeIconUrl: (type: string | null) => (type === 'vue' ? 'data:image/svg+xml,<svg/>' : null),
}))

const { ProjectTypeBadge } = await import('./ProjectTypeBadge')

/**
 * 角标的行为约定。
 *
 * **这里刻意不测视觉规格**（16×16 / 12×12、`bg-white`、`-bottom-px` 那些）。
 * 那种断言钉的是今天的样式：把圆改成 14px、把出格改成 0、换个底色，都会红，
 * 而没有任何东西真的坏——它只是把"调样式"变成了"改测试"。规格要记就记在
 * 设计文档里，测试只该管"该不该画"。
 *
 * 之前这里有三条这样的断言（尺寸两条、class 两条、定位一条），已删。
 */
describe('ProjectTypeBadge', () => {
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
