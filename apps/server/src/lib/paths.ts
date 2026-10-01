import fs from 'node:fs'
import path from 'node:path'

/** 驱动器根，如 `C:/`。Windows 上 `C:` 是「C 盘的当前目录」，和 `C:/` 不是一个意思。 */
const DRIVE_ROOT = /^[a-zA-Z]:\/$/
/** 驱动器路径，如 `C:/...` */
const DRIVE_PATH = /^[a-zA-Z]:\//

/**
 * 统一用正斜杠存储：Windows 反斜杠在 JSON / SQL 里都要转义，容易出错。
 *
 * 但**只改分隔符，不改 Windows 自己的路径前缀**：
 * - `\\nas\share`（UNC）走 posix.normalize 会被折成 `/nas/share`，
 *   Windows 上那是「当前盘根目录下的同名目录」，必然「目录不存在」。
 * - `\\?\C:\...`（扩展长度前缀）同样会被打散 —— core 里刚为长路径加了
 *   `core.longpaths`，这里再把前缀弄坏就白搭。
 * - `C:\` 去掉尾斜杠会变成 `C:`，那是「C 盘的当前目录」而不是根目录。
 *
 * 所以：先认前缀，UNC / 扩展前缀只做「反斜杠→正斜杠 + 折叠重复分隔符」，
 * 驱动器根保留尾斜杠，其余才交给 posix.normalize。
 */
export function normalizePath(input: string): string {
  const raw = input.trim().replace(/\\/g, '/')

  // UNC（//server/share）与扩展长度前缀（//?/…、//./…）：前缀不能折叠掉
  if (raw.startsWith('//')) {
    const body = raw.slice(2).replace(/\/{2,}/g, '/')
    return trimTrailingSlash(`//${body}`)
  }

  // 驱动器根：保留尾斜杠
  const collapsed = raw.replace(/\/{2,}/g, '/')
  if (DRIVE_ROOT.test(collapsed)) return collapsed
  if (DRIVE_PATH.test(collapsed)) return collapsed.replace(/\/$/, '')

  const out = path.posix.normalize(collapsed)
  return trimTrailingSlash(out)
}

/** 去掉尾斜杠，但别把 `C:/` 这类根路径削成 `C:` */
function trimTrailingSlash(p: string): string {
  if (p.length <= 1) return p
  if (DRIVE_ROOT.test(p)) return p
  return p.replace(/\/$/, '')
}

/**
 * 展开 ~ 与相对路径，返回绝对路径。
 * 注意：只做字符串层面的规范化，不触碰磁盘。
 */
export function toAbsolutePath(input: string): string {
  const expanded = expandHome(input.trim())

  // UNC 与扩展前缀本身就是绝对路径，path.resolve 会把 `//` 折成 `/`
  if (expanded.startsWith('//')) return normalizePath(expanded)

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
