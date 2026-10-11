import { describe, expect, it } from 'vitest'
import { builtinCategoryList } from '@git-nest/core'
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
