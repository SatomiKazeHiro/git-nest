import fs from 'node:fs'
import path from 'node:path'

/** 统一用正斜杠存储：Windows 反斜杠在 JSON / SQL 里都要转义，容易出错。 */
export function normalizePath(input: string): string {
  const p = input.trim().replace(/\\/g, '/')
  // Windows 盘符路径不能走 posix.normalize（否则会多出前导斜杠且 fs 访问不到）
  const out = /^[a-zA-Z]:\//.test(p) ? p.replace(/\/{2,}/g, '/') : path.posix.normalize(p)
  return out.length > 1 ? out.replace(/\/$/, '') : out
}

/**
 * 展开 ~ 与相对路径，返回绝对路径。
 * 注意：只做字符串层面的规范化，不触碰磁盘。
 */
export function toAbsolutePath(input: string): string {
  const expanded = expandHome(input.trim())
  const abs = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded)
  return normalizePath(abs)
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '', p.slice(1))
  }
  return p
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
