import fs from 'node:fs'
import path from 'node:path'
import { README_MAX_BYTES } from '../limits.ts'

/**
 * 候选名。**原来只有 `scan.ts` 私有一份**，现在提出来两边共用：
 * 同一个仓库有两个地方各认一组文件名，早晚会漂（扫描时说「没有说明」，
 * 详情页却读出来了）。
 */
export const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'README', 'README.txt'] as const

export interface ReadmeResult {
  /** 命中的文件名，例如 'README.md'；没有可读的就 null。**不是路径**——路径不出本机。 */
  file: string | null
  /** 读到的正文；没有可读的就 null。可能是截断后的一段。 */
  content: string | null
  /** 真被截断了吗（「上限内的完整」不是截断） */
  truncated: boolean
  /** 文件真实大小（字节）——界面上要如实显示 xx MB */
  bytes: number
}

/**
 * 读仓库根目录的 README。
 *
 * **不落库、不缓存**（不变量：能从仓库自己读出来的不存）。每次现读——
 * README 是会变的，缓存一份就等于给用户看一个可能过期的说明。
 *
 * 五种结果必须分得开，混起来的后果都是「界面在说一件不成立的事」：
 * - 读到 → `{ file, content, truncated, bytes }`
 * - 目录不存在 → **throw**，由调用方转 400
 * - 是仓库但没有可读的候选名 → `{ file: null, content: null, truncated: false, bytes: 0 }`
 * - 太大 → 读前 `maxBytes` 字节，`truncated: true`，`bytes` 是**真实**大小
 * - 候选名是二进制 → 试下一个；全都不行 → 当作「没有」
 */
export async function readReadme(
  dir: string,
  opts: { maxBytes?: number } = {},
): Promise<ReadmeResult> {
  const maxBytes = opts.maxBytes ?? README_MAX_BYTES

  // 目录在不在由这里判一次，不靠「每个候选名 stat 都失败」来推断：
  // 那样「目录没了」和「目录在但没有 README」会长得一模一样。
  const dirStat = await fs.promises.stat(dir).catch(() => null)
  if (!dirStat?.isDirectory()) throw new Error(`目录不在了：${dir}`)

  for (const name of README_NAMES) {
    const file = path.join(dir, name)
    const stat = await fs.promises.stat(file).catch(() => null)
    if (!stat?.isFile()) continue

    const truncated = stat.size > maxBytes
    const text = (
      truncated ? await readPrefix(file, maxBytes) : await fs.promises.readFile(file)
    ).toString('utf8')

    if (looksBinary(text, truncated)) continue
    return { file: name, content: text, truncated, bytes: stat.size }
  }

  return { file: null, content: null, truncated: false, bytes: 0 }
}

/**
 * 读前 `maxBytes` 字节。**按字节切而不是按字符切**：`fs.read` 给的是字节，
 * 在多字节字符中间断开会让末尾那几个字变成替换字符。
 *
 * （断开点仍然可能落在一个多字节字符里，于是末尾有一两个替换字符——
 * 那是截断处该有的样子，底部的「加载完整」按钮就是给它准备的。）
 */
async function readPrefix(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.promises.open(file, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * 这是不是一份能当文本读的文档。
 *
 * 判据是**证据的形态与绝对量**，不是「坏字符的比例」——比例这个形式两头都错：
 *
 * - **比例会误杀短文档。** 一个 25 字的中文 README 里恰好有一个 U+FFFD
 *   （从网页复制来的文本混进一个坏字符、人手改编码的残留）就是 4%，
 *   稳稳超过任何小阈值，于是界面说「这个仓库没有 README」——明明有，
 *   而且用户没法把它与「真的没写说明」区分开。
 * - **比例会漏放长文档。** UTF-16LE + BOM（Windows 记事本「另存为 → Unicode」
 *   就是它）解出来每个字母后面跟一个**合法的 U+0000**，只有 BOM 那 2 个字节
 *   变成替换字符：1142 字的文档里占 0.175%，躲过阈值。而它的 ASCII 部分
 *   解出来完全正常，于是渲染出来是一屏乱码，而界面宣称「这是它的说明」。
 *   **文件越长越容易躲过。**
 *
 * 三条里命中任一条就算：
 * 1. **出现裸 NUL** → 不是文本（正常文档里不会出现 U+0000；UTF-16 的填充就是它）
 * 2. **替换字符成片出现（连续 ≥2）** → 编码不是 utf8。GBK 的中文、PNG 头都是成片的
 * 3. **替换字符总数 ≥16** → 整片区域解码失败。真实文档里的坏字符是个位数
 *    （复制粘贴带进来的、编码转换的残留），到十几个就说明这片不是 utf8
 *
 * 单看比例做不到这三条：交替的有效字节与坏字节（压缩数据就是这样）永远不连续，
 * 而一篇只有几十字的真文档里混进一个坏字符就能把比例顶到 4%。
 */
function looksBinary(text: string, truncated: boolean): boolean {
  // 截断处最多留下 3 个替换字符（多字节字符被切断），那一段不能当证据
  const probe = (truncated ? text.slice(0, -3) : text).slice(0, 4096)
  if (probe.length === 0) return false

  let total = 0
  let run = 0
  let longestRun = 0
  for (const ch of probe) {
    if (ch === '\u0000') return true // 裸 NUL：正常文档里不会有
    if (ch === '\uFFFD') {
      total += 1
      run += 1
      if (run > longestRun) longestRun = run
    } else {
      run = 0
    }
  }
  return longestRun >= 2 || total >= 16
}