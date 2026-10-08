import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  categoryLabel,
} from '../src/types.ts'

/**
 * 分类的枚举与显示名。
 *
 * 界面给人看中文，**存进数据库的永远是英文**。这条边界一旦被破坏，后果是
 * 静默的：值被写成「知识库」之后，按分类筛选就再也找不到它，而界面上
 * 不会有任何提示。
 *
 * 钉的是这几条：
 * - **全覆盖**：每一个能存的取值都有中文名，没有「落回英文」的情况
 * - **单向**：拿显示名当键查不到任何条目——想反查必须显式去读键
 * - **没有 personal**：「是不是我自己的」是 `projects.is_own` 那个布尔
 * - **空串在取值里**：未分类是最常见的取值（扫描导入的一律留空）
 * - 表外值原样显示：枚举之后正常路径进不来这样的值，这条只是防脏数据
 */
describe('分类显示名', () => {
  it('每一个能存的取值都有中文显示名', () => {
    for (const c of CATEGORY_VALUES) {
      expect(CATEGORY_LABELS[c], `${c} 没有显示名`).toBeTruthy()
      expect(CATEGORY_LABELS[c]).not.toBe(c)
    }
  })

  it('按存储值取得到中文', () => {
    expect(categoryLabel('')).toBe('未分类')
    expect(categoryLabel('knowledge-base')).toBe('知识库')
    expect(categoryLabel('backups')).toBe('备份')
    expect(categoryLabel('experiments')).toBe('试验')
    expect(categoryLabel('tools')).toBe('工具')
  })

  it('不能拿显示名反查存储值——映射是单向的（翻译只发生在显示层）', () => {
    expect(CATEGORY_LABELS['知识库']).toBeUndefined()
    expect(categoryLabel('知识库')).toBe('知识库')
  })

  it('**没有 personal**：「是不是我自己的」是 isOwn 那个布尔，不是分类', () => {
    // 以前分类等于 personal 会让批量检查跳过它；那个行为拆成布尔之后，
    // 分类里再留一个 personal 只会诱导用户把同一件事记在一个不起作用的地方。
    expect(CATEGORIES).not.toContain('personal' as never)
    expect(CATEGORY_VALUES).not.toContain('personal' as never)
  })

  it('空串（未分类）在取值里——扫描导入的一律留空，那是最常见的取值', () => {
    expect(CATEGORY_VALUES).toContain('')
  })

  it('库里没有的值原样显示，不替换成「未知分类」', () => {
    // 枚举之后正常路径进不来这样的值；这条是防脏数据的退路。
    for (const v of ['工作', 'Personal', 'backups ']) {
      expect(categoryLabel(v)).toBe(v)
    }
  })
})
