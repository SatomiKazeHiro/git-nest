import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Meta } from './ui'

/**
 * 小标签（标签 + 值）。
 *
 * 起因：详情页头部原来写的是 `本地状态 · 刚刚读取` / `远程上次检查 · 从没查过`
 * 这种散装文本，和页面里其它行内点缀混在一起没有统一格式；值缺失时那个 `·`
 * 还孤零零挂在中间。现在统一成标签组件。
 */
describe('Meta', () => {
  it('标签与值都渲染出来', () => {
    render(<Meta label="远程检查" value="2 小时前" />)
    expect(screen.getByText('远程检查')).toBeTruthy()
    expect(screen.getByText('2 小时前')).toBeTruthy()
  })

  it('值缺失时用弱化的占位样式，而不是空着或留个分隔符', () => {
    const { container } = render(<Meta label="远程检查" value="从没查过" placeholder />)
    const chip = container.firstElementChild as HTMLElement
    // 虚线边框 = 弱化
    expect(chip.className).toContain('border-dashed')
    expect(screen.getByText('从没查过')).toBeTruthy()
  })

  it('有值时不用虚线（表示这是确定的信息）', () => {
    const { container } = render(<Meta label="本地状态" value="刚刚" />)
    const chip = container.firstElementChild as HTMLElement
    expect(chip.className).not.toContain('border-dashed')
  })

  it('title 用于解释这个值的来源/新鲜度', () => {
    render(<Meta label="远程检查" value="从没查过" title="还没点过检查更新" />)
    expect(screen.getByTitle('还没点过检查更新')).toBeTruthy()
  })
})
