import { describe, expect, it } from 'vitest'
import {
  RESERVED_CATEGORY_LABELS,
  categoryLabelKey,
  labelProblemMessage,
  normalizeCategoryLabel,
} from '../src/category-label.ts'

/**
 * 分类显示名的规则。
 *
 * 这个文件是这套规则**唯一的实现处**：归一化、比较键、保留字、以及撞名时怎么说。
 * 它以前散在三处（core 一个常量、服务端一段查询、路由里两段措辞），于是「改了规则
 * 忘了改措辞」是必然会发生的——用户会看到一句和事实不符的话。
 */
describe('normalizeCategoryLabel · 存库之前用的那个', () => {
  it('内部连续空白压成一个空格', () => {
    expect(normalizeCategoryLabel('AI  项目')).toBe('AI 项目')
    expect(normalizeCategoryLabel('A\t\tB')).toBe('A B')
  })

  it('两头去掉（连全角空格一起）', () => {
    expect(normalizeCategoryLabel('  工具  ')).toBe('工具')
    expect(normalizeCategoryLabel('\u3000工具\u3000')).toBe('工具')
  })

  it('**不改大小写、不碰中文**：存进去的是用户敲的那个意思', () => {
    expect(normalizeCategoryLabel('AI 项目')).toBe('AI 项目')
    expect(normalizeCategoryLabel('试验')).toBe('试验')
  })
})

describe('categoryLabelKey · 拿它比较的那个', () => {
  it('忽略大小写：AI 项目 与 ai 项目 是同一个名字', () => {
    expect(categoryLabelKey('AI 项目')).toBe(categoryLabelKey('ai 项目'))
  })

  it('内部空白不同的两种写法也是同一个名字', () => {
    expect(categoryLabelKey('AI  项目')).toBe(categoryLabelKey('AI 项目'))
  })

  it('中文不受大小写影响（toLowerCase 对汉字是恒等）', () => {
    expect(categoryLabelKey('工具')).toBe('工具')
  })

  it('保留字的键也算得出来（服务端就是拿它挡重名的）', () => {
    expect(categoryLabelKey(RESERVED_CATEGORY_LABELS[0]!)).toBe('未分类')
  })
})

describe('labelProblemMessage · 措辞跟着规则住在一起', () => {
  it('保留字：说清「它表示没有分类」', () => {
    const message = labelProblemMessage({ kind: 'reserved', label: '未分类' })
    expect(message).toContain('保留名')
    expect(message).toContain('未分类')
  })

  it('重名：点名「跟谁撞了」（只说不重复等于没说）', () => {
    expect(labelProblemMessage({ kind: 'duplicate', label: '工具' })).toContain('工具')
  })
})
