import type { Category } from '@git-nest/core'

/**
 * 把一个 key 翻成显示名。
 *
 * **找不到就原样返回 key**，不编一个「未知分类」出来：那说明清单里存着一个表里
 * 没有的值（分类被删了、或者是手写进库的脏数据），把它显示成原名至少能让人看出来
 * 是哪一条不对；换成「未知分类」只会让人以为自己填错了。
 *
 * 单独放一个文件（而不是塞进 `queries.ts`）：这是个纯函数，可以被单测直接盯住，
 * 不必为了它把 react-query 那一套也拖进来。
 */
export function categoryLabelOf(categories: Category[], key: string): string {
  return categories.find((c) => c.key === key)?.label ?? key
}
