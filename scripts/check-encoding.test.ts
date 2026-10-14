import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXCEPTIONS, findProblemsInText, isExcepted } from './check-encoding.mjs'

/**
 * `pnpm check:encoding` 的**闸门的闸门**。
 *
 * 这个脚本本来长期是红的（3 处刻意的 fixture），而**长期红的闸门会训练人忽略它**。
 * 现在给了逐条例外，于是必须证明两件事，缺一条这个闸门就不可信：
 *
 * 1. 该报的**真的会报**（U+FFFD、代码文件里的 HTML 实体）——**正对照**；
 * 2. 登记的那三处例外**真的被放行**，而且**只放行那三处**：
 *    换一个实体、换一行、换一个文件都要重新报（否则例外就退化成「把规则关掉」）。
 *
 * 没有正对照的闸门等于没有闸门：一个「从来说 OK」的检查比没有检查更坏，
 * 因为它会让人以为查过了。
 *
 * **注意**：这个文件本身也要过 `check-encoding` 那道闸门，所以下面所有样本都是
 * **拼出来**的（`AMP + 'lt;'`），不能在源码里写出字面量实体——否则测试自己会红。
 */

/** 实体的开头。不写字面量 `&`…（其实 `&` 单独不会命中，但统一走这个常量更清楚）。 */
const AMP = String.fromCharCode(38)
/** U+FFFD，不写字面量替换字符（那会让这个文件自己被报 U+FFFD）。 */
const FFFD = String.fromCharCode(0xfffd)

describe('check-encoding：该报的要报出来（正对照）', () => {
  it('普通文本没有问题', () => {
    expect(findProblemsInText('const a = 1\n// 正常的中文注释\n')).toEqual([])
  })

  it('U+FFFD 会被抓到，并给出行号', () => {
    const problems = findProblemsInText(`第一行\n项目说明${FFFD}这是正文\n第三行\n`)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ kind: 'fffd', line: 2, text: FFFD })
  })

  it('代码文件里的 HTML 实体会被抓到（命名实体与数字实体两种写法都认）', () => {
    expect(findProblemsInText(`const x = '${AMP}lt;dir${AMP}gt;'`)[0]).toMatchObject({
      kind: 'entity',
      text: `${AMP}lt;`,
    })
    expect(findProblemsInText(`x = '${AMP}#106;avascript:'`)[0]).toMatchObject({
      kind: 'entity',
      line: 1,
      text: `${AMP}#106;`,
    })
  })

  it('行号按出现位置算（不是恒为 1）', () => {
    expect(findProblemsInText(`a\nb\nc ${AMP}amp; d`)[0]?.line).toBe(3)
  })
})

describe('check-encoding：例外与**真实文件**对得上', () => {
  /*
    这条最要紧：前面的用例只证明「键相同就放行」，而**键可以全部对不上**——
    例外照样一条都不生效、闸门照样红。
    第一版就是这样翻车的：U+FFFD 那条例外的 `text` 误写成整段上下文
    （`项目说明␦这是正文。`），而 `findProblemsInText` 给出的 `text` 只是那**一个字符**，
    于是它从没匹配上。所以这里必须拿真文件跑一遍。
  */
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  it('每条例外在对应文件的那一行上真的命中一个问题，且都被放行', () => {
    for (const e of EXCEPTIONS) {
      const text = readFileSync(path.join(repoRoot, e.file), 'utf8')
      const problems = findProblemsInText(text)

      // 1. 那一行上确实有这个问题（否则例外是死的：文件改了、例外没跟上）
      const hit = problems.find((p) => p.line === e.line && p.kind === e.kind)
      expect(hit, `${e.file}:${e.line} 上应当有一个 ${e.kind} 问题`).toBeDefined()

      // 2. 它的 text 与例外登记的一致（内容变了就要重新报）
      expect(hit.text).toBe(e.text)

      // 3. 于是它被放行
      expect(isExcepted(e.file, hit), `${e.file}:${e.line} 应当被豁免`).toBe(true)
    }
  })

  it('这三处就是当前**全部**的痕迹——一处不多一处不少', () => {
    // 如果哪天又多出一处，闸门本来就该红；这条用例让「多出来的那处」在测试里也可见
    for (const e of EXCEPTIONS) {
      const problems = findProblemsInText(readFileSync(path.join(repoRoot, e.file), 'utf8'))
      const notExcepted = problems.filter((p) => !isExcepted(e.file, p))
      expect(notExcepted, `${e.file} 里还有没登记的问题`).toEqual([])
    }
  })
})

describe('check-encoding：例外只放行登记过的那三处', () => {
  it('三条例外都指向真实存在的文件 + 行 + 内容，且每条都有理由', () => {
    expect(EXCEPTIONS).toHaveLength(3)
    for (const e of EXCEPTIONS) {
      expect(e.file).not.toMatch(/\\/) // 正斜杠形式，跨平台一致
      expect(e.line).toBeGreaterThan(0)
      expect(e.text.length).toBeGreaterThan(0)
      // 「为什么这一处是故意的」不能是空话
      expect(e.why.length).toBeGreaterThan(10)
    }
  })

  it('登记的那条（文件+行+类型+原文）被放行', () => {
    for (const e of EXCEPTIONS) {
      expect(isExcepted(e.file, { kind: e.kind, line: e.line, text: e.text }), e.file).toBe(true)
    }
  })

  it('同一行换成**另一个**实体就重新报（例外钉的是内容，不是位置）', () => {
    const entity = EXCEPTIONS.find((e) => e.kind === 'entity')
    expect(isExcepted(entity.file, { kind: 'entity', line: entity.line, text: `${AMP}#107;` })).toBe(
      false,
    )
  })

  it('同一处挪到**别的行**就重新报', () => {
    const e = EXCEPTIONS[0]
    expect(isExcepted(e.file, { kind: e.kind, line: e.line + 1, text: e.text })).toBe(false)
  })

  it('同样的内容出现在**别的文件**里也照报（不按文件名或目录一刀切）', () => {
    const entity = EXCEPTIONS.find((e) => e.kind === 'entity')
    expect(
      isExcepted('apps/web/src/features/readme/ReadmeView.tsx', {
        kind: 'entity',
        line: entity.line,
        text: entity.text,
      }),
    ).toBe(false)
  })

  it('类型不同不算同一处（U+FFFD 与实体不能互相顶替）', () => {
    const e = EXCEPTIONS[0]
    expect(isExcepted(e.file, { kind: 'fffd', line: e.line, text: e.text })).toBe(false)
  })
})
