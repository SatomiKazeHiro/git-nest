import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sourceFiles, type Offender } from './apiUrl.scan'

/**
 * 「只有 `lib/platform.ts` 能碰 `window.__TAURI__`」这条约束的**扫描器**。
 *
 * 为什么需要它：平台差异一旦散进组件，后果是**静默**的——浏览器里少一个按钮没人发现，
 * 桌面壳里点了没反应；而且只在打包形态才现形（dev 里一路绿灯）。靠人记得
 * 「加平台能力时去改那个模块」不可靠，所以在测试里钉住（见 `platform.guard.test.ts`）。
 *
 * 与 `apiUrl.scan.ts` 同一套做法：扫描器单独成模块，既能被真实用例调用，
 * 也能被「故意放的坏样本」调用——**一个从不失败的闸门等于没有闸门**。
 */

/** 被禁止在别处出现的全局对象名。 */
const TAURI_GLOBAL = '__TAURI__'

/**
 * 豁免的文件（相对 `src/`，正斜杠）。
 *
 * - `lib/platform.ts`：收口本身；
 * - `lib/platform.scan.ts`：**这个文件自己**，它必然写着这个名字（否则没法找它）。
 */
const SELF_EXEMPT = ['lib/platform.ts', 'lib/platform.scan.ts']

/**
 * 这一处 `注释符` 是不是真的开始了一段注释。
 *
 * 判据是「前面什么都没有，或者是空白」。为什么不接受「只要出现就算」：
 * 字符串里的 `http://…` 与 `**\/*.ts` 这类 glob 都会误触发，
 * 而误触发在这里的后果**不是多报，是把后面半行/后面几行当成注释吞掉**
 * ——那会漏报（闸门漏报比多报更糟）。
 */
function isCommentStart(line: string, at: number): boolean {
  return at === 0 || /\s/.test(line[at - 1] ?? '')
}

/** 去掉一行里的注释部分。跨行的块注释用 `inBlock` 记住状态。 */
function stripComments(line: string, state: { inBlock: boolean }): string {
  let code = ''
  let i = 0
  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i)
      if (end === -1) return code
      state.inBlock = false
      i = end + 2
      continue
    }
    const block = line.indexOf('/*', i)
    const single = line.indexOf('//', i)
    const blockAt = block !== -1 && isCommentStart(line, block) ? block : -1
    const singleAt = single !== -1 && isCommentStart(line, single) ? single : -1

    if (singleAt !== -1 && (blockAt === -1 || singleAt < blockAt)) {
      return code + line.slice(i, singleAt)
    }
    if (blockAt === -1) return code + line.slice(i)
    code += line.slice(i, blockAt)
    state.inBlock = true
    i = blockAt + 2
  }
  return code
}

/** 扫一个文件里的 `__TAURI__`，返回 `行号 + 行内容`。注释里的提及不算。 */
export function findTauriGlobalInFile(file: string): string[] {
  const out: string[] = []
  const state = { inBlock: false }
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const code = stripComments(line, state)
      if (code.includes(TAURI_GLOBAL)) out.push(`${index + 1}  ${line.trim()}`)
    })
  return out
}

/** 扫整个 `src/`，返回绕过了平台模块的地方。`srcDir` 可注入，便于用样本目录做正对照。 */
export function findStrayTauriGlobals(srcDir: string): Offender[] {
  const offenders: Offender[] = []
  for (const file of sourceFiles(srcDir)) {
    const relative = path.relative(srcDir, file).split(path.sep).join('/')
    if (SELF_EXEMPT.includes(relative)) continue
    for (const detail of findTauriGlobalInFile(file)) offenders.push({ file: relative, detail })
  }
  return offenders
}
