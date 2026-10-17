import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { ProjectLogo } from './ProjectLogo'

/**
 * 展示组件只有两条约定：接口地址对不对，以及**加载失败之后留不留东西**。
 * 后者是它存在的主要理由——文件被删掉、换成别的名字、识别结论过期，
 * 都会以「图加载不出来」的形式出现在这里，而那一刻界面上必须是干净的名字，
 * 不是一个破图图标。
 *
 * **尺寸与 object-fit 的取值不再断言**：改 32px → 40px、改 `contain`/`cover`，
 * 都是调样式，不该让用例红。（原来有两条纯尺寸断言与四条 `object-*` 断言，已删。）
 */
describe('ProjectLogo', () => {
  it('指向那个项目的取图接口', () => {
    const { container } = render(<ProjectLogo projectId={7} size={24} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/projects/7/logo')
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
