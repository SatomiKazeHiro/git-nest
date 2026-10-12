import { describe, expect, it } from 'vitest'
import { CATEGORY_ICON_KEYS } from '@git-nest/core'
import { CATEGORY_ICONS, categoryIcon, categoryIconLabel } from './icons'
import { searchCategoryIcons } from './iconSearch'

/**
 * 两张表必须**一一对应**：core 决定「哪些名字合法」（服务端据此校验），
 * web 决定「那个名字长什么样」。少一个的后果是静默的——用户能选到、也能存进库，
 * 但设置与左栏都画不出东西；多一个则白占一行。
 */
describe('分类图标的两张表', () => {
  it('core 的每个 key 在 web 注册表里都有', () => {
    for (const key of CATEGORY_ICON_KEYS) {
      expect(CATEGORY_ICONS[key], `${key} 在 web 注册表里没有`).toBeTruthy()
    }
  })

  it('web 注册表里没有 core 不认识的 key（多出来的就是死条目）', () => {
    const known = new Set<string>(CATEGORY_ICON_KEYS)
    for (const key of Object.keys(CATEGORY_ICONS)) {
      expect(known.has(key), `${key} 不在 core 的名单里`).toBe(true)
    }
  })

  it('每一项都有中文名与关键词（搜索与可访问名字都靠它们）', () => {
    for (const [key, entry] of Object.entries(CATEGORY_ICONS)) {
      expect(entry.label, `${key} 没有中文名`).toBeTruthy()
      expect(entry.keywords, `${key} 没有关键词`).toBeTruthy()
    }
  })

  it('认不出来的名字不画东西（不塞占位图）', () => {
    expect(categoryIcon(null)).toBeUndefined()
    expect(categoryIcon('')).toBeUndefined()
    expect(categoryIcon('nope-not-an-icon')).toBeUndefined()
    expect(categoryIconLabel('nope-not-an-icon')).toBeUndefined()
  })

  it('认得出来的名字给出组件与中文名', () => {
    expect(categoryIcon('book-open')).toBeTruthy()
    expect(categoryIconLabel('book-open')).toBe('打开的书')
  })
})

describe('图标搜索', () => {
  const keysOf = (q: string) => searchCategoryIcons(q).map((e) => e.key)

  it('空查询给全部（不筛）', () => {
    expect(searchCategoryIcons('')).toHaveLength(CATEGORY_ICON_KEYS.length)
  })

  it('按中文名搜得到', () => {
    expect(keysOf('打开的书')).toContain('book-open')
  })

  it('按中文关键词搜得到（用户不会知道图标叫什么）', () => {
    expect(keysOf('知识库')).toContain('book-open')
    expect(keysOf('备份')).toContain('archive')
  })

  it('按英文 key 搜得到，且不区分大小写', () => {
    expect(keysOf('book-open')).toContain('book-open')
    expect(keysOf('BOOK')).toContain('book-open')
  })

  it('搜不到的词给空数组，不是全部（否则"筛没了"看着像"没筛"）', () => {
    expect(searchCategoryIcons('zzzzz')).toEqual([])
  })
})
