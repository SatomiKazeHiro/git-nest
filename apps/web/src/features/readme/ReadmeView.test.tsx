import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '@/test/mocks/server'
import { README_FULL_MAX_BYTES } from '@git-nest/core'
import { ReadmeView } from './ReadmeView'

/**
 * README 的渲染。
 *
 * 这一份用例守的是**安全性质**，不是排版：断言全部落在最终 DOM 上，
 * 因为「我们写了策略」不等于「策略在真实的渲染路径上生效」。
 * 策略可能被绕开的地方有三处，都在这里：
 *   1. 手写的 markdown 链接
 *   2. **GFM 自动链接**（裸 URL）——它不长得像链接，最容易在加策略时被忘掉
 *   3. `components` 覆写本身（拦下的 URL 必须渲染成非链接元素）
 */

let seen: URLSearchParams[]
let body: string
let bytes: number
let truncated: boolean

const byteLen = (s: string) => new TextEncoder().encode(s).length

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<ReadmeView projectId={1} />, { wrapper: Wrapper })
}

beforeEach(() => {
  seen = []
  body = '# 标题\n\n正文。\n'
  bytes = byteLen(body)
  truncated = false
  server.use(
    http.get('/api/projects/:id/readme', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url.searchParams)
      const full = url.searchParams.get('full') === '1'
      // 「加载完整」那一次给更多——这里用两份 body 模拟
      const content = full ? body + body : body
      return HttpResponse.json({
        file: 'README.md',
        content,
        truncated: full ? false : truncated,
        bytes: full ? byteLen(content) : bytes,
      })
    }),
  )
})

describe('渲染', () => {
  it('标题与正文都出来了', async () => {
    body = '# 标题\n\n正文。\n'
    renderView()
    await waitFor(() => expect(screen.getByRole('heading', { name: '标题' })).toBeTruthy())
    expect(screen.getByText('正文。')).toBeTruthy()
  })

  it('没有 README → 说清是「没有」，不是空白', async () => {
    server.use(
      http.get('/api/projects/:id/readme', () =>
        HttpResponse.json({ file: null, content: null, truncated: false, bytes: 0 }),
      ),
    )
    renderView()
    await waitFor(() => expect(screen.getByText(/没有 README/)).toBeTruthy())
  })

  it('读不出来 → 把服务端的话说出来，不是一屏空白', async () => {
    server.use(
      http.get('/api/projects/:id/readme', () =>
        HttpResponse.json({ message: '目录不在了，读不到 README' }, { status: 400 }),
      ),
    )
    renderView()
    await waitFor(() => expect(screen.getByText(/目录不在了/)).toBeTruthy())
  })
})

describe('安全 · 执行', () => {
  /*
    下面两条都是**先等文字出来、再断言没有链接**。
    反过来写（先 `waitFor(querySelector('a') === null)`）会被「正在读 README…」
    立刻满足——那一刻页面上本来就没有 `<a>`，断言在数据回来之前就跑完了，
    于是这条用例什么都没测到却一直是绿的（踩过一次）。
  */
  it('[点我](javascript:alert(1)) → 渲染出来没有任何 href', async () => {
    body = '[点我](javascript:alert(1))\n'
    const { container } = renderView()
    const text = await screen.findByText('点我') // 文字还在，只是不再是链接
    expect(container.querySelector('a')).toBeNull()
    expect(text.closest('a')).toBeNull()
  })

  it('[点我](file:///C:/Users/x/secret.txt) → 同样不是链接', async () => {
    body = '[点我](file:///C:/Users/x/secret.txt)\n'
    const { container } = renderView()
    const text = await screen.findByText('点我')
    expect(container.querySelector('a')).toBeNull()
    expect(text.closest('a')).toBeNull()
  })

  it('README 里的原始 <script> 不是真节点', async () => {
    body = '前面\n\n<script>window.__pwned = true</script>\n\n后面\n'
    const { container } = renderView()
    await waitFor(() => expect(screen.getByText('前面')).toBeTruthy())
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

describe('安全 · 网络访问', () => {
  it('远程徽章 → 渲染出来没有 src，一个外部请求都不该有', async () => {
    body = '![CI](https://img.shields.io/badge/ci-passing-green)\n'
    const { container } = renderView()
    await waitFor(() => expect(screen.getByText('CI')).toBeTruthy())
    expect(container.querySelector('img[src^="http"]')).toBeNull()
    // 有 alt 的图片渲染成它的文字，而不是一个加载不出来的破图
    expect(screen.getByText('CI').tagName).not.toBe('IMG')
  })

  it('没 alt 的图片 → 灰底占位，不是破图标', async () => {
    body = '![](https://img.shields.io/badge/x)\n'
    const { container } = renderView()
    await waitFor(() => expect(container.querySelector('.readme-img-placeholder')).toBeTruthy())
    expect(container.querySelector('img')).toBeNull()
  })

  it('**放行的外链**也要带 target=_blank rel=noreferrer（点开才发请求）', async () => {
    body = '[项目主页](https://example.com/a)\n'
    renderView()
    await waitFor(() => expect(screen.getByRole('link', { name: '项目主页' })).toBeTruthy())
    const a = screen.getByRole('link', { name: '项目主页' })
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noreferrer')
    expect(a.getAttribute('href')).toBe('https://example.com/a')
  })

  it('**GFM 自动链接**（裸 URL）走同一条策略，也一样带 noreferrer', async () => {
    body = '详见 https://example.com/b 这个页面。\n'
    renderView()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'https://example.com/b' })).toBeTruthy(),
    )
    expect(screen.getByRole('link', { name: 'https://example.com/b' }).getAttribute('rel')).toContain(
      'noreferrer',
    )
  })
})

describe('分级加载', () => {
  /*
    `bytes` 一律取 **64KB 与 1MB 之间**的值。
    取 1.2MB 的话它已经越过完整上限（README_FULL_MAX_BYTES = 1048576），
    于是走的是「太大了不给按钮」那条分支，压根到不了要测的这条（踩过一次，
    与服务端那条 fixture 是同一个坑）。
  */
  const MID = 500_000 // → formatBytes = "488.3 KB"

  it('没被截断 → 不出现渐变，也不出现按钮', async () => {
    renderView()
    await waitFor(() => expect(screen.getByRole('heading', { name: '标题' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /加载完整文档/ })).toBeNull()
    expect(document.querySelector('.readme-more')).toBeNull()
  })

  it('被截断且没到完整上限 → 渐变 + 按钮，按钮上写着真实大小', async () => {
    truncated = true
    bytes = MID
    renderView()
    const btn = await screen.findByRole('button', { name: /加载完整文档/ })
    // 真实大小如实显示，不四舍五入成「488 KB」
    expect(btn.textContent).toContain('488.3 KB')
    expect(document.querySelector('.readme-more')).toBeTruthy()
  })

  it('点「加载完整文档」→ 请求带 full=1，回来之后渐变与按钮一起消失', async () => {
    truncated = true
    bytes = MID
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: /加载完整文档/ }))
    await waitFor(() => expect(seen.some((q) => q.get('full') === '1')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: /加载完整文档/ })).toBeNull())
    expect(document.querySelector('.readme-more')).toBeNull()
    // 内容接上了（两份 body → 两个同名标题）
    await waitFor(() => expect(screen.getAllByRole('heading', { name: '标题' })).toHaveLength(2))
  })

  it('**超过完整上限 → 不给按钮**（给了也是点了没用的死控件）', async () => {
    truncated = true
    bytes = README_FULL_MAX_BYTES + 10
    renderView()
    await waitFor(() => expect(screen.getByText(/太大/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /加载完整文档/ })).toBeNull()
  })

  it('加载完整失败 → 按钮还在，下面说清为什么，不是一声不响', async () => {
    server.use(
      http.get('/api/projects/:id/readme', ({ request }) => {
        const full = new URL(request.url).searchParams.get('full') === '1'
        if (full) return HttpResponse.json({ message: '读不出来了' }, { status: 500 })
        return HttpResponse.json({
          file: 'README.md',
          content: '# 标题\n',
          truncated: true,
          bytes: MID,
        })
      }),
    )
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: /加载完整文档/ }))
    await waitFor(() => expect(screen.getByText(/读不出来了/)).toBeTruthy())
    // 渐变与按钮都留着，还能再点一次
    expect(screen.getByRole('button', { name: /加载完整文档/ })).toBeTruthy()
    expect(document.querySelector('.readme-more')).toBeTruthy()
  })
})