import { describe, expect, it } from 'vitest'
import { readmeUrl } from './urlPolicy'

/**
 * README 里的 URL 闸门。
 *
 * 这是**执行安全**与**网络访问安全**两类里唯一由我们自己负责的部分
 * （`react-markdown` 只保证它自己不渲染原始 HTML，不管我们会不会偷偷发请求）。
 *
 * 拦下的返回**空串**而不是原值：空串让下游知道「这个 URL 不可用」，
 * 而原值会让它照常渲染成那个链接——那才是洞。
 */

describe('readmeUrl · 链接', () => {
  it.each([
    'http://x.com/a',
    'https://x.com/a',
    'HTTPS://x.com/a',
    'mailto:a@x.com',
    'https://x.com/a?b=1#c',
  ])('放行 %s', (u) => {
    expect(readmeUrl(u, 'link')).toBe(u)
  })

  it.each([
    ['javascript:alert(1)', '执行型协议'],
    ['JaVaScRiPt:alert(1)', '大小写混着写也拦得住'],
    ['data:text/html,<script>alert(1)</script>', 'data: 链接'],
    ['file:///C:/Users/x/secret.txt', '本机文件'],
    ['vbscript:msgbox(1)', '老协议'],
    ['./docs/install.md', '相对路径：我们不显示仓库里其它文件'],
    ['../other.md', '相对路径'],
    ['#anchor', '页内锚点'],
    ['/absolute/path', '绝对路径'],
    ['', '空串'],
    ['   ', '纯空白'],
    // entity 编码：真正的攻击面是这一种，闸门安全**不是因为它认得**，
    // 而是因为 remark 在 `urlTransform` 之前就把 `&#106;` 解成了 `j`。
    // 哪天 remark 换了实现（把解码挪到闸门之后），这里收到的就是字面量
    // `&#106;avascript:`——开头的协议正则不匹配，仍然返回 ''（歪打正着），
    // 但如果那时有人为「让相对链接能用」放宽了那个正则，它立刻变成洞。
    ['&#106;avascript:alert(1)', 'entity 编码的 javascript:'],
    ['&#x6a;avascript:alert(1)', '十六进制 entity'],
  ])('拦下 %s（%s）', (u) => {
    expect(readmeUrl(u, 'link')).toBe('')
  })
})

describe('readmeUrl · 图片', () => {
  it('放行内联的 data:image/*', () => {
    const u = 'data:image/png;base64,iVBORw0KGgo='
    expect(readmeUrl(u, 'image')).toBe(u)
  })

  it.each([
    ['https://img.shields.io/badge/ci-passing-green', '远程徽章——本项目最该拦的一个'],
    ['http://x.com/a.png', 'http 同样拦'],
    ['file:///C:/Users/x/secret.png', '本机文件'],
    ['./assets/logo.png', '相对路径'],
    ['data:text/html,<script>alert(1)</script>', '非图片的 data:'],
    ['javascript:alert(1)', '执行型协议'],
  ])('拦下 %s（%s）', (u) => {
    expect(readmeUrl(u, 'image')).toBe('')
  })
})

describe('两类不能串', () => {
  it('data:image/* 不许当链接放行（它只对图片有意义）', () => {
    expect(readmeUrl('data:image/png;base64,AAAA', 'link')).toBe('')
  })

  it('https 也不许当图片放行', () => {
    expect(readmeUrl('https://x.com/a.png', 'image')).toBe('')
  })
})