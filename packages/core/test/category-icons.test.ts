import { describe, expect, it } from 'vitest'
import { CATEGORY_ICON_KEYS, isCategoryIconKey } from '../src/category-icons.ts'
import { BUILTIN_CATEGORIES } from '../src/types.ts'

/**
 * 分类图标的名字表。
 *
 * 这张表是**服务端校验**与**web 端渲染**之间的契约：服务端只认这里面的名字，
 * web 端按名字找组件。所以两件事必须有测试钉住：名字不重复，以及
 * **内置四项现在用的种子一个都不能少**（漏一个，那个内置分类当场掉图标）。
 */
describe('CATEGORY_ICON_KEYS', () => {
  it('没有重复（重复会让 web 那张 Record 静默少一项）', () => {
    expect(new Set(CATEGORY_ICON_KEYS).size).toBe(CATEGORY_ICON_KEYS.length)
  })

  it('**内置四项的种子都在**：漏一个就掉图标', () => {
    for (const c of BUILTIN_CATEGORIES) {
      expect(CATEGORY_ICON_KEYS, `${c.key} 的图标 ${c.icon} 不在名单里`).toContain(c.icon)
    }
  })

  it('数量在合理区间（太少不够挑，太多没人翻）', () => {
    expect(CATEGORY_ICON_KEYS.length).toBeGreaterThan(50)
    expect(CATEGORY_ICON_KEYS.length).toBeLessThan(120)
  })

  it('isCategoryIconKey 认名单内的、不认名单外的', () => {
    expect(isCategoryIconKey('book-open')).toBe(true)
    expect(isCategoryIconKey('nope-not-an-icon')).toBe(false)
  })
})
