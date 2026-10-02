import { describe, expect, it } from 'vitest'
import { updateProjectSchema } from '../src/schemas.ts'

/**
 * 部分更新（PATCH）的契约：**只提交的字段才该出现在输出里**。
 *
 * 这里守的是一个真实踩过的坑：字段写成 `.nullish().transform(...)` 时，
 * transform 会挂在最外层，zod 会对「根本没提交的键」照样执行它，
 * 把 `undefined` 变成 `null` 并把键物化进输出。后果是 PATCH 只改一个字段
 * 也会把 remoteUrl 一起写成 NULL。
 *
 * 「记录」是 NOT NULL 的列（空 = 空串，不用 null），所以它没有那个 transform，
 * 但同样必须遵守「没提交就不出现」——否则只改名字会把记录清空。
 */
describe('updateProjectSchema 的部分更新语义', () => {
  it('只改 name 时，未提交的字段不出现在输出里', () => {
    const parsed = updateProjectSchema.parse({ name: '新名字' })

    expect(parsed).toEqual({ name: '新名字' })
    expect('remoteUrl' in parsed).toBe(false)
    expect('record' in parsed).toBe(false)
  })

  it('没提交任何字段要被 refine 拦下（不是悄悄通过）', () => {
    expect(() => updateProjectSchema.parse({})).toThrow(/没有要修改的字段/)
  })

  it('显式提交 null 表示「就是要清空」，此时字段必须出现', () => {
    const parsed = updateProjectSchema.parse({ remoteUrl: null })

    expect('remoteUrl' in parsed).toBe(true)
    expect(parsed.remoteUrl).toBeNull()
    // 但没提交的字段仍然不该被牵连
    expect('record' in parsed).toBe(false)
  })

  it('提交空串等价于清空（保留原有的 v || null 语义）', () => {
    const parsed = updateProjectSchema.parse({ remoteUrl: '' })

    expect(parsed.remoteUrl).toBeNull()
  })

  it('记录：提交值就带上，提交空串就是清空', () => {
    expect(updateProjectSchema.parse({ record: '在 B 站看到的' }).record).toBe('在 B 站看到的')
    expect(updateProjectSchema.parse({ record: '' }).record).toBe('')
  })

  it('记录首尾空白会去掉（存的是文本，不是排版）', () => {
    expect(updateProjectSchema.parse({ record: '  写了点东西\n\n' }).record).toBe('写了点东西')
  })
})
