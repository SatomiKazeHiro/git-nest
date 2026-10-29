import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecordView } from './RecordView'

/**
 * 详情页那条**只读**的「记录」。
 *
 * 这一份守两件事：
 *
 * 1. **链接能点**（这条是原来就有的要求）：记录里写的多是「在 B 站看到 → 顺着找到
 *    GitHub」这类句子，不可点等于要手抄。
 * 2. **它现在与编辑框的预览共用同一套渲染**（`MarkdownBody`）：写的时候预览成什么样，
 *    这里就该是什么样。两处各写一份迟早飘开，而飘开的表现正是「我写的时候看着是
 *    粗体，保存完怎么就变了」。
 *
 * 顺带把「换成 Markdown 之后**老记录的显示会变**」这件事钉在用例上：`*x*` 这种
 * 当星号用的写法现在会被解释成 `<em>`。这不是 bug、也不是顺手修掉的东西，
 * 是有意的语义变更（见 `RecordView` 的注释），所以这里如实断言它。
 */

describe('RecordView · 没写的时候', () => {
  it('空记录给一句引导，而不是一块空白', () => {
    const { container } = render(<RecordView record="" />)
    expect(screen.getByText(/还未有记录/)).toBeTruthy()
    // 空记录不该渲染出 markdown 的那层容器
    expect(container.querySelector('.readme')).toBeNull()
  })
})

describe('RecordView · 链接', () => {
  it('记录里的链接可点，并带 target=_blank + rel=noreferrer', () => {
    render(<RecordView record="在 https://example.com/a 看到的" />)

    const link = screen.getByRole('link', { name: 'https://example.com/a' })
    expect(link.getAttribute('href')).toBe('https://example.com/a')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('markdown 写法的链接也一样可点', () => {
    render(<RecordView record="看 [这个仓库](https://example.com/b)" />)

    const link = screen.getByRole('link', { name: '这个仓库' })
    expect(link.getAttribute('href')).toBe('https://example.com/b')
  })
})

describe('RecordView · Markdown 被渲染', () => {
  it('`**粗体**` 出来是 `<strong>`（与编辑框的预览同一套）', () => {
    const { container } = render(<RecordView record="**重点**" />)

    expect(container.querySelector('strong')?.textContent).toBe('重点')
  })

  it('标题与列表也按 markdown 走', () => {
    const { container } = render(<RecordView record={'# 标题\n\n- 一\n- 二\n'} />)

    expect(screen.getByRole('heading', { name: '标题' })).toBeTruthy()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  /*
    这条不是「顺手修好」的用例，而是**如实记下语义变更**：老记录里拿 `*` 当星号用
    （例如 `2 * 3`、`*必看`），换成 markdown 之后会被解释掉。
    真要处理（转义 / 给记录一个纯文本标记）是另一件事，这里只把现状钉住，
    免得以后有人以为「记录一直是纯文本」。
  */
  it('老记录里的 `*x*` 现在会被解释成 `<em>`：这是有意的语义变更，不是 bug', () => {
    const { container } = render(<RecordView record="*必看*" />)

    expect(container.querySelector('em')?.textContent).toBe('必看')
  })
})

describe('RecordView · 安全（与 README 同一条策略）', () => {
  it('`javascript:` 链接不成为链接，文字还在', () => {
    const { container } = render(<RecordView record="[点我](javascript:alert(1))" />)

    const text = screen.getByText('点我')
    expect(container.querySelector('a')).toBeNull()
    expect(text.closest('a')).toBeNull()
  })

  it('记录里的原始 HTML 被丢掉，而不是渲染出来', () => {
    const { container } = render(
      <RecordView record={'前面\n\n<script>window.__rec = true</script>\n\n后面'} />,
    )

    expect(screen.getByText('前面')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __rec?: boolean }).__rec).toBeUndefined()
  })
})
