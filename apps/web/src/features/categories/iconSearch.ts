import { CATEGORY_ICON_KEYS, type CategoryIconKey } from '@git-nest/core'
import { CATEGORY_ICONS } from './icons'

/**
 * 图标搜索：**key / 中文名 / 关键词三处都匹配，不区分大小写**。
 *
 * 单独一个纯模块（不放进 `icons.tsx`）：这样它能被单测直接盯住，不必把 React 那一套
 * 拖进来。中文能搜到靠的是 `toLowerCase()` 对汉字是恒等变换——所以同一条规则对
 * 中英文都成立，不需要两套关键词。
 *
 * 空查询给**全部**；搜不到给**空数组**（不是"没筛"）——否则「筛没了」看着像「没筛」，
 * 用户会在一个空网格前以为图标丢了。
 */
export interface CategoryIconEntry {
  key: CategoryIconKey
  label: string
  keywords: string
}

export function searchCategoryIcons(query: string): CategoryIconEntry[] {
  const q = query.trim().toLowerCase()
  return CATEGORY_ICON_KEYS.filter((key) => {
    if (!q) return true
    const entry = CATEGORY_ICONS[key]
    return (
      key.includes(q) ||
      entry.label.toLowerCase().includes(q) ||
      entry.keywords.toLowerCase().includes(q)
    )
  }).map((key) => ({
    key,
    label: CATEGORY_ICONS[key].label,
    keywords: CATEGORY_ICONS[key].keywords,
  }))
}
