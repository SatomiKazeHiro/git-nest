import { describe, expect, it } from 'vitest'
import { RESERVED_CATEGORY_LABELS, builtinCategoryList } from '@git-nest/core'
import { UNCATEGORIZED } from '@/store/ui'
import { categoryLabelOf } from './label'

/**
 * 分类名怎么显示。
 *
 * 这是「不许编一个没有依据的说法」那条约定在分类上的落点：表里没有的 key
 * **原样显示**，不要换成「未知分类」——用户看到 `ai` 至少知道是哪一条记录不对，
 * 看到「未知分类」只会以为是自己当时填错了。
 */
describe('categoryLabelOf', () => {
  it('表里有就翻成显示名', () => {
    expect(categoryLabelOf(builtinCategoryList(), 'experiments')).toBe('试验')
  })

  it('用户新增的也翻得出来', () => {
    expect(
      categoryLabelOf(
        [{ key: 'ai', label: 'AI 项目', icon: null, builtin: false, projectCount: 3 }],
        'ai',
      ),
    ).toBe('AI 项目')
  })

  it('表里没有就原样返回 key，不编「未知分类」', () => {
    expect(categoryLabelOf(builtinCategoryList(), 'ghost')).toBe('ghost')
  })
})

/**
 * 保留字与哨兵必须是同一个词，这条把它拉到一起。
 *
 * 它跨越两个包：保留字在 core（服务端校验读它，不许有人把分类叫「未分类」），
 * 哨兵在 web 的 store（左栏那一行「未分类」）。两边各改各的时候谁都不会报错——
 * 症状是「某个分类名被拒了，可界面上根本找不到那个词」，或者反过来的同形两行。
 * 这是唯一会把它们对齐的地方。
 */
describe('保留字与哨兵', () => {
  it('core 的 RESERVED_CATEGORY_LABELS 恰好就是 store 的 UNCATEGORIZED', () => {
    expect([...RESERVED_CATEGORY_LABELS]).toEqual([UNCATEGORIZED])
  })
})
