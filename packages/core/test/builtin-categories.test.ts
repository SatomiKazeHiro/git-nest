import { describe, expect, it } from 'vitest'
import { BUILTIN_CATEGORIES, builtinCategoryList } from '../src/types.ts'

/**
 * 内置分类与「分类可配置，但不用数据迁移」这件事。
 *
 * 这是整个设计的地基：**内置四个的 key 必须就是库里已经存着的那些值**
 * （`projects.category` 里现在写的就是它们）。只要这条成立，新表就只是给这些值补上
 * 「显示名 + 图标 + 是不是内置」，一个字节的数据都不用搬。
 *
 * 所以这里把 key 写死成**字面量**来断言，而不是引用某个常量：那个常量被改掉时，
 * 这条必须红——它就是「key 不会变」这句话的执行者。
 */
describe('BUILTIN_CATEGORIES', () => {
  it('key 就是库里已经存着的四个值（这是「不用迁移」的地基）', () => {
    expect(BUILTIN_CATEGORIES.map((c) => c.key)).toEqual([
      'knowledge-base',
      'backups',
      'experiments',
      'tools',
    ])
  })

  it('标签是给人看的中文，「试验」不是「实验」', () => {
    expect(BUILTIN_CATEGORIES.map((c) => c.label)).toEqual(['知识库', '备份', '试验', '工具'])
  })

  it('sortOrder 从 0 起、不重复（用户新增的排在它们后面）', () => {
    expect(BUILTIN_CATEGORIES.map((c) => c.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it('**没有 personal**：「是不是我自己的」是 `projects.is_own` 那个布尔，不是分类', () => {
    // 以前分类等于 personal 会让批量检查跳过它；那个行为拆成布尔之后，
    // 分类里再留一个 personal 只会诱导用户把同一件事记在一个不起作用的地方。
    expect(BUILTIN_CATEGORIES.map((c) => c.key)).not.toContain('personal')
  })

  it('builtinCategoryList 给出接口形状：内置、引用数 0', () => {
    const list = builtinCategoryList()
    expect(list.map((c) => c.key)).toEqual(BUILTIN_CATEGORIES.map((c) => c.key))
    expect(list.every((c) => c.builtin)).toBe(true)
    expect(list.every((c) => c.projectCount === 0)).toBe(true)
  })
})
