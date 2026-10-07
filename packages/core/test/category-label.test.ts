import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS,
  INITIAL_CATEGORIES,
  categoryLabel,
} from '../src/types.ts'

/**
 * 分类的中英映射。
 *
 * 界面给人看中文，**存进数据库的永远是英文**。这条边界一旦被破坏，后果是
 * 静默的：分类被写成「我自己的项目」之后，「哪些算自己的项目」那条规则
 * （`includePersonal` 默认关掉时跳过 personal 分类）就再也匹配不上，
 * 而界面上不会有任何提示——只是那几个仓库照样被拿去联网检查。
 *
 * 所以这里钉的是「翻译只发生在显示层」：
 * - 映射表覆盖全部五个建议值（漏一个就有一项在界面上露出英文）
 * - **表是双向好查的**：拿显示名当键是**找不到**任何条目的。想反查
 *   （界面上看到「我自己的项目」→ 想让人填 `personal`）会直接落空，
 *   除非显式去读 `CATEGORY_LABELS` 的键
 * - 没登记过的值原样返回，不替换成「未知分类」之类的说法——用户可以自由
 *   填写，硬换只会让他以为自己填错了
 */
describe('分类显示名', () => {
  it('五个建议值都有中文显示名', () => {
    for (const c of INITIAL_CATEGORIES) {
      expect(CATEGORY_LABELS[c], `${c} 没有显示名`).toBeTruthy()
      expect(CATEGORY_LABELS[c]).not.toBe(c)
    }
  })

  it('按存储值取得到中文', () => {
    expect(categoryLabel('personal')).toBe('我自己的项目')
    expect(categoryLabel('knowledge-base')).toBe('知识库')
    expect(categoryLabel('backups')).toBe('备份')
    expect(categoryLabel('experiments')).toBe('试验')
    expect(categoryLabel('tools')).toBe('工具')
  })

  it('不能拿显示名反查存储值——映射是单向的（翻译只发生在显示层）', () => {
    // 想从「我自己的项目」倒推该填什么，必须显式去读键；按显示名查是查不到的。
    expect(CATEGORY_LABELS['我自己的项目']).toBeUndefined()
    expect(categoryLabel('我自己的项目')).toBe('我自己的项目')
  })

  it('区分大小写：Personal 不是 personal', () => {
    // 这一点是故意的，而且是必须钉住的——服务端判断的是精确匹配，
    // 填成 Personal 就会绕过「跳过自己的项目」那条规则。
    expect(categoryLabel('Personal')).toBe('Personal')
  })

  it('用户自己填的分类原样显示，不替换成「未知分类」', () => {
    for (const v of ['我的项目', '工作', '', 'PERSONAL', 'personal ']) {
      expect(categoryLabel(v)).toBe(v)
    }
  })

  it('存储值本身始终可用：显示名可以随时换掉，规则不受影响', () => {
    // 判决「这条算不算自己的项目」用的永远是 INITIAL_CATEGORIES 里那个英文
    // 字面值，而不是 categoryLabel 的结果——那是一条跨前后端的硬约定。
    expect(INITIAL_CATEGORIES).toContain('personal')
  })
})
