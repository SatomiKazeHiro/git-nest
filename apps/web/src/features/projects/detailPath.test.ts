import { describe, expect, it } from 'vitest'
import { detailPath } from './detailPath'

/**
 * 点某一行要去哪儿。
 *
 * **再点当前这一行 = 反选**：`/` 与 `/projects/:id` 渲染的是同一个界面，区别只在
 * 清单下面那一轨有没有内容。所以「关掉详情」在这套路由里就是「回到 `/`」——
 * 不需要另立一个 `detailOpen` 状态，也不需要记住上次看的是谁（地址栏里就是它）。
 *
 * 这个判定抽成纯函数，是因为它有两个调用点（行的链接、行的点击）而只能在**一个**
 * 地方定义：两处各写一遍 `currentId === id ? '/' : …`，改一处漏一处不会报错，
 * 而症状是「点名字能关、点空白处关不掉」这种只有用户会碰到的怪事。
 */
describe('detailPath · 再点一次就是反选', () => {
  it('点别的仓库：去它的详情', () => {
    expect(detailPath(1, 2)).toBe('/projects/2')
  })

  it('点当前打开的那一个：回清单（详情那一轨就不渲染了）', () => {
    expect(detailPath(2, 2)).toBe('/')
  })

  it('没选中任何项目时，点谁都去它的详情', () => {
    expect(detailPath(null, 7)).toBe('/projects/7')
  })
})
