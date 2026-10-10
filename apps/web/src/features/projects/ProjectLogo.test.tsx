import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { ProjectLogo } from './ProjectLogo'

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
    expect(container.querySelector('img')?.style.height).toBe('16px')
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
