import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readReadme } from '../../src/git/readme.ts'
import { cleanup, tempDir } from '../helpers/repo.ts'

/**
 * README 全文读取。
 *
 * 钉住的是**五种结果必须分得开**：读到了 / 没有 / 截断了 / 是二进制 / 目录没了。
 * 混起来的后果都是「界面在说一件不成立的事」——
 * 把二进制当文本渲染是一屏乱码，把超大文件当作没有是骗人，
 * 把目录没了当作没有则让「这个项目不见了」变成「它没有 README」。
 */

const dirs: string[] = []
const track = (dir: string) => (dirs.push(dir), dir)
// 测试 helper 的 write 只收字符串，二进制用例直接用 fs
const put = (dir: string, name: string, data: string | Buffer) =>
  fs.writeFileSync(path.join(dir, name), data)

afterAll(() => cleanup(...dirs))

describe('readReadme', () => {
  it('找到 README.md：原样返回，truncated 为假', async () => {
    const dir = track(tempDir())
    put(dir, 'README.md', '# 标题\n\n正文。\n')
    const r = await readReadme(dir)
    expect(r.file).toBe('README.md')
    expect(r.content).toBe('# 标题\n\n正文。\n')
    expect(r.truncated).toBe(false)
    expect(r.bytes).toBe(Buffer.byteLength('# 标题\n\n正文。\n'))
  })

  it('**候选名不只认 .md**：只有 .txt 的说明也要读得出来', async () => {
    const dir = track(tempDir())
    put(dir, 'README.txt', '纯文本说明\n')
    const r = await readReadme(dir)
    expect(r.file).toBe('README.txt')
    expect(r.content).toBe('纯文本说明\n')
  })

  it('多个候选名都在时，按 README_NAMES 的顺序取第一个', async () => {
    const dir = track(tempDir())
    // **只能用大小写不同不构成两个文件的候选名**：Windows 上 NTFS 默认
    // 大小写不敏感，`README.md` / `readme.md` / `README.MD` 是同一个文件，
    // 后写的会把先写的覆盖掉（踩过一次）。这里用 `README` 与 `README.txt`。
    put(dir, 'README.txt', '纯文本\n')
    put(dir, 'README', '无扩展名\n')
    expect((await readReadme(dir)).file).toBe('README')
  })

  it('同名条目是个目录 → 跳过它，不是文件不算 README', async () => {
    const dir = track(tempDir())
    fs.mkdirSync(path.join(dir, 'README'))
    put(dir, 'README.md', '# 真正的\n')
    expect((await readReadme(dir)).file).toBe('README.md')
  })

  it('一个候选名都没有 → file/content 为 null，**不是**报错', async () => {
    await expect(readReadme(track(tempDir()))).resolves.toEqual({
      file: null,
      content: null,
      truncated: false,
      bytes: 0,
    })
  })

  it('目录不存在 → throw（调用方据此转 400）', async () => {
    const missing = path.join(track(tempDir()), '没有这个目录')
    await expect(readReadme(missing)).rejects.toThrow(/目录/)
  })

  it('超上限：截断，**bytes 是真实大小而不是给出去的大小**', async () => {
    const dir = track(tempDir())
    put(dir, 'README.md', 'x'.repeat(5000))
    const r = await readReadme(dir, { maxBytes: 1000 })
    expect(r.truncated).toBe(true)
    expect(r.bytes).toBe(5000)
    expect(r.content).toHaveLength(1000)
  })

  it('没超上限时 truncated 为假（「没截断」与「上限内的完整」不是一回事）', async () => {
    const dir = track(tempDir())
    put(dir, 'README.md', '短')
    expect((await readReadme(dir, { maxBytes: 1000 })).truncated).toBe(false)
  })

  it('**二进制不是文档**：跳过它，继续试下一个候选名', async () => {
    const dir = track(tempDir())
    // PNG 头 + 一串非法字节。**下一候选名必须是大小写不同的另一个文件**，
    // 否则 Windows 上写第二个会把第一个覆盖掉，这条用例就测不到「跳过」了。
    put(dir, 'README.md', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0xfd, 0xfc]))
    put(dir, 'README.txt', '真正的说明\n')
    expect((await readReadme(dir)).file).toBe('README.txt')
  })

  it('几个候选名全是二进制 → 当作「没有」，不给一屏乱码', async () => {
    const dir = track(tempDir())
    // 交替的高低位字节：解码成 utf8 几乎全是替换字符
    put(dir, 'README.md', Buffer.from(Array.from({ length: 400 }, (_, i) => (i % 2 ? 0xff : 0x41))))
    expect((await readReadme(dir)).file).toBeNull()
  })

  it('**非 utf8 的中文也不许变成乱码页**：至少要被认出来不是文本', async () => {
    const dir = track(tempDir())
    // GBK 的中文在 utf8 下解出来是连续的替换字符
    put(dir, 'README.md', Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xd6, 0xd0, 0xce, 0xc4].flatMap((b) => [b, 0x00])))
    expect((await readReadme(dir)).file).toBeNull()
  })

  /*
    下面三条是复审抓出来的：`looksBinary` 原来只看「U+FFFD 的比例 > 1%」，
    于是**同时往两个方向错**。

    错的方向一（误杀）：比例这个形式与「短文件」相冲突。一个 25 字的中文 README
    里恰好有一个 U+FFFD（从网页复制来的文本里混进一个坏字符，人手改编码的残留，
    README 里粘了别处一段坏编码）——4% > 1%，于是被判成二进制，界面说
    「这个仓库没有 README」。**明明有，却被告知没有，而且没法与「真的没写」区分。**

    错的方向二（漏放）：UTF-16LE + BOM 的 README（Windows 记事本「另存为 → Unicode」
    就会存成这个），BOM 只贡献 2 个坏字符，1142 字的文件里占比 0.175%，躲过判据。
    而 UTF-16 的 ASCII 部分解码成的是**合法的 U+0000**，不是替换字符——
    这个判据天生看不见。渲染出来每个字母后面跟一个 NUL，一屏乱码，
    而界面明确宣称「这是它的说明」。**文件越长越容易躲过。**
  */
  it('短中文 README 里有一个 U+FFFD → **仍然读得出来**（散落的坏字符不是二进制）', async () => {
    const dir = track(tempDir())
    // 25 个字符、1 个替换字符 = 4%，稳稳超过 1%
    put(dir, 'README.md', '项目说明�这是正文。这是正文。这是正文。')
    const r = await readReadme(dir)
    expect(r.file).toBe('README.md')
    expect(r.content).toContain('项目说明')
  })

  it('UTF-16LE + BOM → 当作「没有」，不给一屏乱码（每个字母后面跟 NUL）', async () => {
    const dir = track(tempDir())
    // **正文要够长**：BOM 只贡献 2 个坏字符，文件越长占比越低。短文件里
    // 2/90 = 2.2% 仍然超过 1%，那条用例会「因为错误的原因通过」——
    // 真正躲过判据的是长文件（2/1142 = 0.175%），所以这里写够长。
    const text = ('# Project\n\nThis is a normal English readme.\n\n' + 'x'.repeat(200) + '\n').repeat(6)
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    put(dir, 'README.md', utf16)
    expect((await readReadme(dir)).file).toBeNull()
  })

  it('**截断正好切在多字节字符中间** → 末尾那几个替换字符不算二进制证据', async () => {
    const dir = track(tempDir())
    // 纯中文，按字节切必然切在某个字中间，于是末尾留下 1–3 个替换字符
    put(dir, 'README.md', '文'.repeat(2000))
    const r = await readReadme(dir, { maxBytes: 1000 }) // 1000 / 3 = 333 个完整的字 + 1 字节残余
    expect(r.file).toBe('README.md')
    expect(r.truncated).toBe(true)
  })
})