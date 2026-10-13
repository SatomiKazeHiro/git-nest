import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findApiLiteralsInFile, findUncollectedApiLiterals } from './apiUrl.scan'

/**
 * 「所有 `/api` 拼接都只走 `lib/api.ts` 的 `apiUrl()`」这条约束的机器检查。
 *
 * 为什么需要它：漏掉一处的后果不是报错，而是**静默**——那一处只在打包形态下才现形
 * （没有 vite 代理时 `/api` 打到 webview 自己身上），dev 与全部现有测试都是绿的。
 * 靠人记得「加接口时也要走 apiUrl」不可靠。
 *
 * 第二个用例是**闸门的闸门**：拿一批故意写坏的样本证明它真的会报，
 * 因为「从不失败的检查」等于没有检查。
 */

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('API 地址的单一收口', () => {
  it('应用源码里裸 /api 字面量只出现在 lib/api.ts', () => {
    const offenders = findUncollectedApiLiterals(srcDir)
    expect(
      offenders,
      `这些地方绕过了 lib/api.ts 的 apiUrl()：\n${offenders
        .map((o) => `${o.file}:${o.detail}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('扫描器真的抓得住违规（正对照 + 不误报）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'git-nest-scan-'))
    try {
      mkdirSync(path.join(dir, 'lib'))
      mkdirSync(path.join(dir, 'features'))
      mkdirSync(path.join(dir, 'test'))

      // 坏样本：新加的调用点绕过了收口 → 必须被抓到
      writeFileSync(
        path.join(dir, 'features', 'Bad.tsx'),
        [
          '// 注释里提 /api 不算（这里是说明）',
          'export function Bad() {',
          "  return fetch('/api/projects')",
          '}',
          '',
        ].join('\n'),
      )
      // 好样本一：收口文件自己（豁免）
      writeFileSync(path.join(dir, 'lib', 'api.ts'), "export const u = `/api${p}`\n")
      // 好样本二：import 模块路径，不是地址
      writeFileSync(
        path.join(dir, 'features', 'Good.tsx'),
        "import { api } from '@/lib/api'\n" + "export const x = api.get('/projects')\n",
      )
      // 好样本三：msw handler 描述的是服务端路径，不该被算成前端调用点
      writeFileSync(
        path.join(dir, 'test', 'server.ts'),
        "export const h = http.get('/api/settings', () => null)\n",
      )

      const offenders = findUncollectedApiLiterals(dir)
      expect(offenders.map((o) => o.file)).toEqual(['features/Bad.tsx'])
      expect(offenders[0]?.detail).toContain("fetch('/api/projects')")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('注释与 import 行不会造成误报（误报的闸门等于没有闸门）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'git-nest-scan2-'))
    try {
      writeFileSync(
        path.join(dir, 'a.ts'),
        [
          '/* 块注释里的 /api/projects */',
          ' * 块注释续行里的 /api/projects',
          '// 行注释里的 /api/projects',
          "import { api } from '@/lib/api'",
          "export const u = `/api${p}`", // 这里**会**被报（它确实绕过了 apiUrl）
          '',
        ].join('\n'),
      )
      // 只报最后那一条真正的拼接，前四种一律不报
      expect(findApiLiteralsInFile(path.join(dir, 'a.ts'))).toEqual(['5  export const u = `/api${p}`'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
