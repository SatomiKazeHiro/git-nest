/**
 * 分类可以用的图标 —— **这里只存名字（字符串），不存组件**。
 *
 * 分工：core 是两端共用的那一层，而 `lucide-react` 只有 web 端有；所以
 * 「哪些名字合法」住在 core（服务端据此校验），「名字对应哪个组件、中文名叫什么」
 * 住在 web（`apps/web/src/features/categories/icons.tsx`）。
 * 两边各有一份表，靠一条测试钉住**一一对应**（少一个就红）。
 *
 * 名字一律是 lucide 的 kebab-case（`book-open` → `<BookOpen />`）。
 *
 * **内置四项的种子必须在这张表里**（`book-open` / `archive` / `flask-conical` /
 * `wrench`）——漏一个，那个内置分类当场掉图标（有测试专门钉这四个）。
 *
 * 分组只是给人读的：将来想删就整段删（删掉一个还想留着的图标，那条对应关系测试
 * 不会报，但设置里它会变成"认不出来"——所以删之前先想想有没有人已经用了）。
 */
export const CATEGORY_ICON_KEYS = [
  // 技术 / 开发
  'code',
  'terminal',
  'git-branch',
  'git-commit',
  'git-merge',
  'bug',
  'cpu',
  'database',
  'server',
  'package',
  'wrench',
  'hammer',
  'puzzle',
  'braces',
  'file-code',
  'webhook',

  // 数据与图表
  'bar-chart-3',
  'line-chart',
  'pie-chart',
  'activity',
  'trending-up',
  'table',
  'sigma',
  'gauge',
  'calculator',
  'percent',

  // AI 与算法
  'brain',
  'sparkles',
  'bot',
  'network',
  'workflow',
  'git-fork',
  'atom',
  'radar',
  'flask-conical',

  // 文档与知识
  'book-open',
  'book',
  'library',
  'file-text',
  'sticky-note',
  'graduation-cap',
  'lightbulb',
  'newspaper',
  'bookmark',
  'scroll-text',
  'file-check',

  // 媒体
  'image',
  'video',
  'music',
  'camera',
  'mic',
  'film',
  'palette',
  'brush',
  'clapperboard',
  'headphones',

  // 网络与云
  'cloud',
  'cloud-upload',
  'globe',
  'wifi',
  'link',
  'share-2',
  'rss',
  'shield',
  'lock',
  'key',

  // 符号与标记
  'star',
  'heart',
  'flag',
  'tag',
  'hash',
  'at-sign',
  'zap',
  'flame',
  'bell',
  'pin',

  // 生活与杂项
  'home',
  'briefcase',
  'shopping-cart',
  'coffee',
  'plane',
  'sun',
  'moon',
  'leaf',
  'archive',
  'folder',
  'clock',
  'map-pin',
  'wallet',
  'utensils',
  'paw-print',
  'gamepad-2',
  'laptop',
  'user',
] as const

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number]

/** 一个名字是不是合法的分类图标。服务端校验、web 端搜索都用它。 */
export function isCategoryIconKey(value: string): value is CategoryIconKey {
  return (CATEGORY_ICON_KEYS as readonly string[]).includes(value)
}
