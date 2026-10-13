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
/*
  只扫仓库根：`.` 会递归到 apps / packages / docs / scripts，
  而 README.md（中文最密的那个文件）、package.json、tsconfig.base.json 就在根下
  ——只列子目录会漏掉它们，还会让同一个文件被扫两遍（`.` 加子目录）。
  walk() 跳过 `.` 开头的目录、node_modules、dist，所以扫根不会跑偏。
*/
const ROOTS = ['.']
/*
  `target` 是 Rust/Cargo 的构建缓存（加 Tauri 壳之后才出现）。必须跳过，两个理由：
  1. 里面有**压缩后的二进制资源**被 Cargo 以 `.css` 之类的名字落盘，按 utf8 读进来
     必然是一堆 U+FFFD —— 那是格式使然，不是编码坏掉的痕迹，报出来就是纯噪音；
  2. 它动辄 GB 级，扫一遍纯属浪费（这个脚本是提交前跑的）。
*/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'target'])
const EXT = /\.(ts|tsx|md|json|css|sql|mjs)$/

/** 真正该排除的目录：.reference 里是参考资料，.gitattributes / pnpm-lock 有自己的编码规则 */
const ALLOWLIST = new Set(['pnpm-lock.yaml'])

/**
 * 被 HTML 洗过一遍的痕迹：`&` 后面跟 lt / gt / amp / quot 或数字实体那种写法。
 *
 * 源码里出现基本只有一个来源——某个环节做过 HTML 转义（`runner.ts` 的注释里
 * 就躺过一个 `<dir>` 的实体写法，U+FFFD 检查抓不到它）。所以**代码文件**里当成错误。
 * **markdown 例外，只警告**：文档里引用实体是合法的（审计报告里就要拿它举例）。
 *
 * 正则用字符串拼出来，是为了让这个脚本不去匹配自己源码里的同类字面量。
 */
const ENTITY = new RegExp('&(?:' + ['lt', 'gt', 'amp', 'quot'].join('|') + '|#\\d+);')

let bad = 0
let warned = 0
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
    const relative = path.relative(repoRoot, full)

    const idx = text.indexOf('\uFFFD')
    if (idx >= 0) {
      bad += 1
      const line = text.slice(0, idx).split('\n').length
      const around = JSON.stringify(text.slice(Math.max(0, idx - 20), idx + 20))
      console.error(`${relative}:${line}  U+FFFD  ${around}`)
    }

    const entity = ENTITY.exec(text)
    if (entity) {
      const line = text.slice(0, entity.index).split('\n').length
      const message = `${relative}:${line}  HTML 实体 ${JSON.stringify(entity[0])}（多半被 HTML 转义过一遍）`
      if (entry.name.endsWith('.md')) {
        warned += 1
        console.warn(`警告 ${message}——文档里可能是引用，自己确认一下`)
      } else {
        bad += 1
        console.error(message)
      }
    }
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
  console.log(
    `编码检查通过：${checked} 个文件里没有 U+FFFD，代码文件里没有 HTML 实体` +
      (warned > 0 ? `（${warned} 处文档实体见上面的警告）` : ''),
  )
  process.exit(0)
}
console.error(`\n发现 ${bad} 处可疑痕迹（U+FFFD 或代码里的 HTML 实体），修掉再提交`)
process.exit(1)
