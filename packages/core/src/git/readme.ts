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
 * **不落库、不缓存**（不变量 12：能从仓库自己读出来的不存）。每次现读——
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

    if (looksBinary(text)) continue
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
 * 前 4KB 里 utf8 解码失败的替换字符超过 1% → 当二进制。
 *
 * 不引 `is-binary-file` 之类的依赖，三行就够，而这一挡拦住的是「一屏看不懂的
 * 东西」：PNG 被改名成 README.md、GBK 编码的中文说明——渲染出来用户无从读起，
 * 而界面会说「这是它的说明」。
 */
function looksBinary(text: string): boolean {
  const probe = text.slice(0, 4096)
  if (probe.length === 0) return false
  let bad = 0
  for (const ch of probe) if (ch === '�') bad += 1
  return bad / probe.length > 0.01
}