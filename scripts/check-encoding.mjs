#!/usr/bin/env node
/**
 * 扫一遍源码里有没有 U+FFFD 替换字符（以及代码文件里被 HTML 转义过的痕迹）。
 *
 * 背景：写中文文件时偶尔会混进 U+FFFD（编码坏掉的痕迹）。它在页面上表现为
 * 一个方块或问号，肉眼扫一遍很容易漏掉，测试也测不出来。
 *
 * 用法：node scripts/check-encoding.mjs   （提交前跑一下；也可 pnpm check:encoding）
 *
 * ## 为什么有 EXCEPTIONS 而不是把规则放松
 *
 * 有三处痕迹是**故意的测试 fixture**——测试断言的正是那个字符本身。
 * 一个长期红的闸门会训练人忽略它，所以必须给例外；但例外要**逐条、带理由、
 * 且钉住内容**，绝不能按目录或扩展名一刀切（那等于把规则关掉一半）。
 *
 * ## 判定逻辑是纯函数（`findProblemsInText` / `isExcepted`）
 *
 * 抽出来是为了能被 `scripts/check-encoding.test.ts` 直接喂样本
 * ——**没有正对照的闸门等于没有闸门**：一个「从来说 OK」的检查比没有检查更坏，
 * 因为它会让人以为查过了。所以这里既要有「该报的报出来」，也要有「例外真的放行」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** HTML 实体的开头（`&`）。**不写字面量**：这个文件自己也要过这道闸门。 */
const AMP = String.fromCharCode(38)

/**
 * 逐条例外：**文件 + 行号 + 类型 + 被放行的那段原文**。
 *
 * 四个字段都参与匹配，尤其是 `text`：**只钉文件+行号是不够的**——同一行被改成
 * 另一个实体（或那一行被别的痕迹顶掉）时闸门必须重新报。`line` 变了也同理，
 * 这正是「内容动过就重新报」想要的效果。
 *
 * 每条都写清**为什么这一处是故意的**（它断言的就是这个字符）。
 *
 * 注意 `text` 本身也不能写字面量实体（那会让这个文件自己命中闸门），
 * 所以用 `${AMP}` 拼出来——`AMP` 就是一个 `&` 字符，拼出来的值与文件里的一致。
 */
export const EXCEPTIONS = [
  {
    file: 'apps/web/src/features/readme/ReadmeView.test.tsx',
    line: 170,
    kind: 'entity',
    text: `${AMP}#106;`,
    why: '断言「markdown 源里被 entity 编码过的 javascript: 链接」——被断言的正是这个实体写法本身。',
  },
  {
    file: 'apps/web/src/features/readme/urlPolicy.test.ts',
    line: 38,
    kind: 'entity',
    text: `${AMP}#106;`,
    why: '注释解释「remark 在 urlTransform 之前就把这个实体解成了 j」——举的例子就是这个实体。',
  },
  {
    file: 'packages/core/test/git/readme.test.ts',
    line: 130,
    kind: 'fffd',
    // 命中的**就是那一个字符**（`findProblemsInText` 的 text 是匹配到的原文，
    // 上下文只进 detail）。第一版这里误写成整段上下文，于是例外从未生效。
    text: '\uFFFD',
    why: '往 README fixture 里**故意塞一个 U+FFFD**（`项目说明\uFFFD这是正文。`），测编码坏掉的内容怎么呈现——它就是要证明的东西。',
  },
]

/** 一个问题：`kind` 决定怎么措辞，`text` 是被命中的那段原文（例外靠它钉住）。 */
export function findProblemsInText(text) {
  const problems = []

  const fffdAt = text.indexOf('\uFFFD')
  if (fffdAt >= 0) {
    problems.push({
      kind: 'fffd',
      line: text.slice(0, fffdAt).split('\n').length,
      text: '\uFFFD',
      detail: JSON.stringify(text.slice(Math.max(0, fffdAt - 20), fffdAt + 20)),
    })
  }

  const entity = ENTITY.exec(text)
  if (entity) {
    problems.push({
      kind: 'entity',
      line: text.slice(0, entity.index).split('\n').length,
      text: entity[0],
      detail: JSON.stringify(entity[0]) + '（多半被 HTML 转义过一遍）',
    })
  }

  return problems
}

/**
 * 这一条问题是不是被显式豁免了？
 *
 * `file` 用**正斜杠**形式（与例外表一致），这样 Windows 上也不会因为分隔符不同而漏豁免。
 */
export function isExcepted(file, problem) {
  return EXCEPTIONS.some(
    (e) => e.file === file && e.line === problem.line && e.kind === problem.kind && e.text === problem.text,
  )
}

/** 被这条问题命中的例外（用于输出「为什么放行」）；没有就是 undefined。 */
function exceptionFor(file, problem) {
  return EXCEPTIONS.find(
    (e) => e.file === file && e.line === problem.line && e.kind === problem.kind && e.text === problem.text,
  )
}

// ---------------------------------------------------------------------------
// 下面是 CLI 部分
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 该扫的文件（相对仓库根、正斜杠分隔），按字典序——输出顺序稳定，便于对比。 */
export function collectFiles(rootDir = repoRoot) {
  const out = []
  const walk = (dir) => {
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
      out.push(path.relative(rootDir, full).split(path.sep).join('/'))
    }
  }
  walk(rootDir)
  return out.sort()
}

function main() {
  let bad = 0
  let warned = 0
  let excepted = 0
  const files = collectFiles()

  for (const relative of files) {
    const text = readFileSync(path.join(repoRoot, relative), 'utf8')

    for (const problem of findProblemsInText(text)) {
      const exempt = exceptionFor(relative, problem)
      if (exempt) {
        excepted += 1
        console.log(`豁免 ${relative}:${problem.line}  ${problem.kind}——${exempt.why}`)
        continue
      }

      const message = `${relative}:${problem.line}  ${
        problem.kind === 'fffd' ? 'U+FFFD' : 'HTML 实体'
      }  ${problem.detail}`
      // markdown 里的实体只警告：文档引用实体是合法的
      if (problem.kind === 'entity' && relative.endsWith('.md')) {
        warned += 1
        console.warn(`警告 ${message}——文档里可能是引用，自己确认一下`)
      } else {
        bad += 1
        console.error(message)
      }
    }
  }

  if (bad === 0) {
    console.log(
      `编码检查通过：${files.length} 个文件里没有 U+FFFD，代码文件里没有 HTML 实体` +
        (excepted > 0 ? `（${excepted} 处是已登记的测试 fixture）` : '') +
        (warned > 0 ? `（${warned} 处文档实体见上面的警告）` : ''),
    )
    process.exit(0)
  }
  console.error(`\n发现 ${bad} 处可疑痕迹（U+FFFD 或代码里的 HTML 实体），修掉再提交`)
  process.exit(1)
}

// 直接 `node scripts/check-encoding.mjs` 才跑 CLI；被 import（测试）时什么都不做
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
