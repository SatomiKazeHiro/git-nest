import { describe, expect, it } from 'vitest'
import { BUILTIN_CATEGORIES } from '../src/types.ts'

/**
 * 「显示名」与「存进库的值」是两件事。
 *
 * 这条边界一旦破了，后果是**静默的**：把「知识库」写进 `projects.category` 之后，
 * 按分类筛选就再也找不到它，而界面上不会有任何提示。
 *
 * 分类变成可配置的之后，这条约定换了实现——不再是「枚举 + 一张翻译表」
 * （那两个导出已经删掉了：名单现在是数据，显示名存在表里、由接口读出来），
 * 而是「key 与 label 分开写：key 是稳定、URL 安全的那个，label 只给人看」。
 * 用户自建的分类由服务端从名称生成唯一的 key，见 `apps/server/src/repos/categories.ts`。
 */
describe('分类的显示名与存储值', () => {
  it('内置项的 label 与 key 是两样东西（界面给人看中文，存进库的永远是 key）', () => {
    for (const c of BUILTIN_CATEGORIES) {
      expect(c.label, `${c.key} 没有显示名`).toBeTruthy()
      expect(c.label).not.toBe(c.key)
    }
  })

  it('key 是 URL 安全的 slug——它要进 URL 与查询串，中文 label 不进', () => {
    for (const c of BUILTIN_CATEGORIES) {
      expect(c.key, `${c.key} 不是 slug`).toMatch(/^[a-z0-9-]+$/)
    }
  })
})
