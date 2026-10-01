import { describe, expect, it } from 'vitest'
import { normalizePath, toAbsolutePath } from '../src/lib/paths.ts'

/**
 * 路径规范化的几条真实坑（审计发现）。
 *
 * 统一用正斜杠存储是刻意的（反斜杠在 JSON / SQL 里都要转义），但**不能**顺手
 * 把 Windows 的路径前缀也改掉：
 * - UNC（`\\nas\share\repo`）走 posix.normalize 会被折成 `/nas/share/repo`，
 *   Windows 上那是「当前盘根目录下的同名目录」，必然「目录不存在」；
 * - 扩展长度前缀 `\\?\` 同样会被打散 —— 讽刺的是 core 里刚为长路径加了
 *   `core.longpaths`；
 * - `C:/` 去掉尾斜杠会变成 `C:`，而 Windows 上 `C:` 是「C 盘的当前目录」
 *   而不是根目录，入库存的就是这个语义错误的值。
 */
describe('normalizePath 的 Windows 路径前缀', () => {
  it('UNC 路径保留双斜杠前缀', () => {
    expect(normalizePath('\\\\nas\\repos\\proj')).toBe('//nas/repos/proj')
  })

  it('UNC 路径的尾斜杠去掉，但前缀不动', () => {
    expect(normalizePath('//nas/repos/proj/')).toBe('//nas/repos/proj')
  })

  it('扩展长度前缀 \\\\?\\ 保留', () => {
    expect(normalizePath('\\\\?\\C:\\very\\long\\path')).toBe('//?/C:/very/long/path')
  })

  it('驱动器根保留尾斜杠（C: 是「当前目录」，语义不同）', () => {
    expect(normalizePath('C:\\')).toBe('C:/')
    expect(normalizePath('C:/')).toBe('C:/')
  })

  it('普通盘符路径照旧：正斜杠、无尾斜杠', () => {
    expect(normalizePath('D:\\Git\\personal\\git-nest\\')).toBe('D:/Git/personal/git-nest')
  })

  it('重复分隔符折叠，但不动前缀', () => {
    expect(normalizePath('D:\\\\Git\\\\a')).toBe('D:/Git/a')
  })
})

describe('toAbsolutePath', () => {
  it('UNC 输入不被打散', () => {
    expect(toAbsolutePath('\\\\nas\\share\\repo')).toBe('//nas/share/repo')
  })

  it('相对路径仍然解析成绝对路径', () => {
    expect(toAbsolutePath('.')).toMatch(/^[A-Za-z]:\//)
  })
})
