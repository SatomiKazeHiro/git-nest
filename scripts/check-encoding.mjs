#!/usr/bin/env node
/**
 * 扫一遍源码里有没有 U+FFFD 替换字符。
 *
 * 背景：写中文文件时偶尔会混进 U+FFFD（编码坏掉的痕迹）。它在页面上表现为
 * 一个方块或问号，肉眼扫一遍很容易漏掉，测试也测不出来。
 *
 * 用法：node scripts/check-encoding.mjs   （提交前跑一下；也可 pnpm check:encoding）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['apps', 'packages', 'docs', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
const EXT = /\.(ts|tsx|md|json|css|sql|mjs)$/

/** 真正该排除的目录：.reference 里是参考资料，.gitattributes / pnpm-lock 有自己的编码规则 */
const ALLOWLIST = new Set(['pnpm-lock.yaml'])

let bad = 0
let checked = 0

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!EXT.test(entry.name) || ALLOWLIST.has(entry.name)) continue

    checked += 1
    const text = readFileSync(full, 'utf8')
    const idx = text.indexOf('\uFFFD')
    if (idx < 0) continue

    bad += 1
    const line = text.slice(0, idx).split('\n').length
    const around = JSON.stringify(text.slice(Math.max(0, idx - 20), idx + 20))
    console.error(`${path.relative(repoRoot, full)}:${line}  ${around}`)
  }
}

for (const root of ROOTS) {
  const dir = path.join(repoRoot, root)
  try {
    if (statSync(dir).isDirectory()) walk(dir)
    else walk(repoRoot)
  } catch {
    // 目录不存在就跳过
  }
}

if (bad === 0) {
  console.log(`编码检查通过：${checked} 个文件里没有 U+FFFD`)
  process.exit(0)
}
console.error(`\n发现 ${bad} 处坏字符（U+FFFD），修掉再提交`)
process.exit(1)
