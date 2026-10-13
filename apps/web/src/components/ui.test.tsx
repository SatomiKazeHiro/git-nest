import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, Meta } from './ui'

/**
 * 按钮的**默认 `type`**。
 *
 * 起因是一次真实的 bug：编辑资料弹窗里那两枚「编辑 / 预览」切换按钮没写 `type`，
 * 而 HTML 里 `<button>` 默认是 `submit`——点一下等于提交表单，弹窗直接关掉。
 * 修法放在组件里（默认 `type="button"`），因为靠每个调用点自觉记得写
 * `type="button"`，就是让默认值继续替所有人做错事。
 */
describe('Button · 默认不提交', () => {
  it('什么都不写时是 `type="button"`，不是 HTML 那个 `submit`', () => {
    render(<Button>普通按钮</Button>)
    expect(screen.getByRole('button', { name: '普通按钮' }).getAttribute('type')).toBe('button')
  })

  it('放进 `<form>` 里点它**不会**提交（这才是那个 bug 的正面用例）', () => {
    let submitted = 0
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitted += 1
        }}
      >
        <Button>切换视图</Button>
      </form>,
    )

    screen.getByRole('button', { name: '切换视图' }).click()
    expect(submitted).toBe(0)
  })

  it('真要原生提交时显式写 `type="submit"`（这条路仍然留着）', () => {
    let submitted = 0
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitted += 1
        }}
      >
        <Button type="submit">保存</Button>
      </form>,
    )

    screen.getByRole('button', { name: '保存' }).click()
    expect(submitted).toBe(1)
  })
})

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
