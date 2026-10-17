import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findStrayTauriGlobals, findTauriGlobalInFile } from './platform.scan'

/**
 * 「web 与桌面壳的差异只允许出现在 `lib/platform.ts`」这条约束的机器检查。
 *
 * 为什么需要它：漏掉一处的后果不是报错，而是**静默**——浏览器里少画一个按钮没人发现，
 * 桌面壳里点了没反应；而两种形态里都看不出「这里本该有平台分支」。只能靠扫描。
 *
 * 第二个用例是**闸门的闸门**：拿故意写坏的样本证明它真的会报，
 * 因为「从不失败的检查」等于没有检查。
 */

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('平台差异的单一收口', () => {
  it('应用源码里只有 lib/platform.ts 碰 window.__TAURI__', () => {
    const offenders = findStrayTauriGlobals(srcDir)
    expect(
      offenders,
      `这些地方绕过了 lib/platform.ts（平台差异必须收在那一个模块里）：\n${offenders
        .map((o) => `${o.file}:${o.detail}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('扫描器真的抓得住违规（正对照 + 不误报）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'git-nest-platform-'))
    try {
      mkdirSync(path.join(dir, 'lib'))
      mkdirSync(path.join(dir, 'components'))

      // 坏样本：组件里直接读全局对象 → 必须被抓到
      writeFileSync(
        path.join(dir, 'components', 'Bad.tsx'),
        [
          'export function Bad() {',
          '  const g = window.__TAURI__',
          '  return g ? null : null',
          '}',
          '',
        ].join('\n'),
      )
      // 好样本一：收口自己（豁免）
      writeFileSync(path.join(dir, 'lib', 'platform.ts'), 'export const g = globalThis.__TAURI__\n')
      // 好样本二：只在注释里提到它（那是说明，不是实现）
      writeFileSync(
        path.join(dir, 'components', 'Good.tsx'),
        ['// 平台差异走 @/lib/platform，别在这里读 __TAURI__', 'export const x = 1', ''].join('\n'),
      )

      const offenders = findStrayTauriGlobals(dir)
      expect(offenders.map((o) => o.file)).toEqual(['components/Bad.tsx'])
      expect(offenders[0]?.detail).toContain('window.__TAURI__')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /*
    误报与漏报各钉一条。这几种都是真踩过的：
    - 块注释里**没写星号**的续行（第一版只认 `//` 与 `*` 开头的行，于是这种被算成实现）；
    - glob 字符串 `'**\/*.ts'` 里的 `/*` 不是注释开头（当成注释开头会把后面几行吞掉 → 漏报）；
    - URL 里的 `//` 同理，它后面那半行还可能是真的实现。
  */
  it('注释不误报、字符串里的注释符不漏报（误报的闸门等于没有闸门）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'git-nest-platform2-'))
    try {
      const file = path.join(dir, 'a.ts')
      writeFileSync(
        file,
        [
          '/*',
          ' * 块注释续行里的 __TAURI__',
          ' */',
          '// 行注释里的 __TAURI__',
          '/*',
          '  块注释里没写星号的那一行，也提到 __TAURI__',
          '*/',
          "const pattern = '**/*.ts'",
          "const a = 'http://example.com'; const b = globalThis.__TAURI__", // 这一行**会**被报
          '',
        ].join('\n'),
      )
      expect(findTauriGlobalInFile(file)).toEqual([
        "9  const a = 'http://example.com'; const b = globalThis.__TAURI__",
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
