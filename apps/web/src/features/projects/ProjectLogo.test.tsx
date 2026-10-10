import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { ProjectLogo } from './ProjectLogo'

/**
 * jsdom **不加载图片**：`naturalWidth/Height` 恒为 0，而组件正是靠它们决定
 * contain 还是 cover。所以只能手动定义这两个只读属性，再触发 onLoad
 * ——这不是在测 jsdom，是在测组件拿到真实尺寸之后的选择。
 */
function loadWithSize(container: HTMLElement, w: number, h: number) {
  const img = container.querySelector('img') as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true })
  fireEvent.load(img)
  return container.querySelector('img') as HTMLImageElement
}

/**
 * 展示组件只有两条约定：接口地址对不对，以及**加载失败之后留不留东西**。
 * 后者是它存在的主要理由——文件被删掉、换成别的名字、识别结论过期，
 * 都会以「图加载不出来」的形式出现在这里，而那一刻界面上必须是干净的名字，
 * 不是一个破图图标。
 */
describe('ProjectLogo', () => {
  it('指向那个项目的取图接口，尺寸由调用方给', () => {
    const { container } = render(<ProjectLogo projectId={7} size={24} />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/api/projects/7/logo')
    expect(img?.style.width).toBe('24px')
    expect(img?.style.height).toBe('24px')
  })

  it('宽度给了就必须给高度：preflight 的 `height: auto` 会把宽图压成细条', () => {
    const { container } = render(<ProjectLogo projectId={1} />)
    // 缺省 32：它替换的是清单里那枚图标的位置
    expect(container.querySelector('img')?.style.height).toBe('32px')
  })

  it('横长条（超出 1:1.5）用 cover 填满：goink 那个 520×140 的字标', () => {
    const { container } = render(<ProjectLogo projectId={7} />)
    expect(loadWithSize(container, 520, 140).className).toContain('object-cover')
  })

  it('竖长条（另一个方向超出 1:1.5）也用 cover', () => {
    const { container } = render(<ProjectLogo projectId={7} />)
    expect(loadWithSize(container, 100, 400).className).toContain('object-cover')
  })

  it('方形仍然 contain：把一个方形的 logo 裁掉才是真的错', () => {
    const { container } = render(<ProjectLogo projectId={7} />)
    expect(loadWithSize(container, 512, 512).className).toContain('object-contain')
  })

  it('刚好 1:1.5 不算超出（边界留在 contain 那一侧）', () => {
    const { container } = render(<ProjectLogo projectId={7} />)
    expect(loadWithSize(container, 300, 200).className).toContain('object-contain')
  })

  it('加载失败就整个消失——不留破图，也不留占位', () => {
    const { container } = render(<ProjectLogo projectId={7} />)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
  })

  it('装饰性的：读屏不该念它（名字就在紧右边）', () => {
    const { container } = render(<ProjectLogo projectId={7} />)
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('')
  })
})
