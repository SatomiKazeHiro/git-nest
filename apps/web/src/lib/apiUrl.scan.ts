import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 「所有 `/api` 拼接都只走 `lib/api.ts` 的 `apiUrl()`」这条约束的**扫描器**。
 *
 * 为什么需要这条约束：漏掉一处的后果不是报错，而是**静默**——那一处只在打包形态下
 * 才现形（没有 vite 代理时 `/api` 打到 webview 自己身上），dev 与全部现有测试都是绿的。
 * 靠人记得「加接口时也要走 apiUrl」不可靠，所以在测试里钉住（见 `apiUrl.guard.test.ts`）。
 *
 * 扫描器单独成一个模块、不写成 `.test.ts`：这样它既被真实用例调用，
 * 又能被「故意放的坏样本」调用——**一个从不失败的闸门等于没有闸门**，
 * 所以「它真的能抓到违规」这件事本身也要有用例。
 */

/**
 * 匹配「字符串字面量里出现 `<某处>/api`」。
 *
 * `[^'"`]*` 要求它落在**同一个字符串字面量**内（不跨引号匹配）。
 * 注意 `from '@/lib/api'` 这种模块说明符也长得像，所以还要靠下面的
 * 「跳过 import 行 + 跳过注释」两道筛子（见 `findApiLiterals`）。
 */
const API_LITERAL = /['"`][^'"`]*\/api/

/**
 * `from '@/lib/api'` / `import '@/lib/api'` 不算调用点（那是模块路径，不是地址）。
 *
 * **`/api` 后面允许还有字符**：`from './apiUrl.scan'` 这种「模块名以 api 开头」的
 * 导入也长得像地址，第一版的正则只认「以 /api 结尾」，于是把
 * `import { … } from './apiUrl.scan'` 报成了违规（假警报的闸门会被人直接关掉）。
 */
const IMPORT_LINE = /\bfrom\s+['"`][^'"`]*\/api[^'"`]*['"`]|\bimport\s+['"`][^'"`]*\/api[^'"`]*['"`]/

/** 注释行：`// …` 或块注释的续行 `* …`。注释里提 `/api` 是**说明**，不是调用点。 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/**
 * 扫描一个文件里的裸 `/api` 字面量，返回 `行号  + 行内容`。
 * 只做「行级」判断——够用且没有误报，因为真实的调用点都是整行可辨认的字符串字面量。
 */
export function findApiLiteralsInFile(file: string): string[] {
  const out: string[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (isCommentLine(line)) return
      if (IMPORT_LINE.test(line)) return
      if (API_LITERAL.test(line)) out.push(`${index + 1}  ${line.trim()}`)
    })
  return out
}

/** 递归收集目录下的应用源码（排除测试：那里面的 `/api` 是 msw 描述的**服务端路径**）。 */
export function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // `test/` 里是 msw handler 与测试基建，描述的是服务端有哪些路径，
      // 不经过 apiUrl 才是对的（第一版漏了这条，把 server.ts 的两条 handler 报成了违规）
      if (entry.name === 'test') continue
      out.push(...sourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    out.push(full)
  }
  return out
}

export interface Offender {
  /** 相对 `src/` 的路径，正斜杠分隔 */
  file: string
  /** `行号 + 行内容` */
  detail: string
}

/**
 * 扫描时豁免的文件（相对 `src/`，正斜杠）。
 *
 * - `lib/api.ts`：收口本身，裸 `/api` 就该长在那里；
 * - `lib/apiUrl.scan.ts`：**这个文件自己**。它的正则字面量里必然写着 `/api`
 *   （否则它没法找 `/api`），任何「扫源码」的工具都躲不开这一点，
 *   所以显式豁免比把正则写成看不懂的样子好——真让它去匹配自己的模式串，
 *   只会得到一个永远红的闸门。
 */
const SELF_EXEMPT = ['lib/api.ts', 'lib/apiUrl.scan.ts']

/**
 * 扫整个 `src/`，返回绕过了收口的调用点。`srcDir` 可注入，便于用样本目录做正对照。
 */
export function findUncollectedApiLiterals(srcDir: string): Offender[] {
  const offenders: Offender[] = []
  for (const file of sourceFiles(srcDir)) {
    const relative = path.relative(srcDir, file).split(path.sep).join('/')
    if (SELF_EXEMPT.includes(relative)) continue
    for (const detail of findApiLiteralsInFile(file)) offenders.push({ file: relative, detail })
  }
  return offenders
}
