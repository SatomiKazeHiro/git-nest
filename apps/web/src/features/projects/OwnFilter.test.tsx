import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { server } from '@/test/mocks/server'
import { App } from '@/App'
import { useUiStore } from '@/store/ui'

/**
 * 左栏的「我自己的」筛选。
 *
 * 两条容易被写坏的性质：
 *
 * 1. **它和分类 / 标签是叠加的，不是互斥的。** 「我的 tools」是一个完全合理的
 *    查询，所以点它不该把分类清掉。反过来，分类与标签之间是互斥的（它们是同一层
 *    的两种分组方式），点一个会取消另一个——那两条已经这样了。
 * 2. **它走服务端筛选，不是前端过滤。** 前端过滤等于把整份清单拉下来再筛，
 *    搜索也会跟着失灵。判据是列表请求的 URL 上有没有 `own=1`。
 */

function makeProject(id: number, name: string, isOwn: boolean, category = 'tools') {
  return {
    id,
    name,
    path: `D:/repos/${name}`,
    remoteUrl: null,
    isOwn,
    category,
    record: '',
    addedAt: '2026-10-01T00:00:00Z',
    sortOrder: id,
    tags: [],
    latestCheck: null,
    attention: 'ready',
  }
}

/** 记下每次列表请求带了什么查询参数 */
let seen: URLSearchParams[]

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, gcTime: 0 } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<App />, { wrapper: Wrapper })
}

beforeEach(() => {
  seen = []
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null, own: null, attention: null, sort: null },
    formOpen: false,
    editingId: null,
    navOpen: true,
    detailOpen: true,
  })
  server.use(
    http.get('/api/projects', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url.searchParams)
      // theirs 没有分类：「未分类」那一桶才真的存在，否则那条用例是空的
      const all = [makeProject(1, 'mine', true), makeProject(2, 'theirs', false, '')]
      const own = url.searchParams.get('own')
      const category = url.searchParams.get('category')
      const list = all
        .filter((p) => (own === null ? true : p.isOwn === (own === '1')))
        // `!== null` 而不是真值：searchParams.get 缺席时是 null、
        // 显式给了空串是 ''，而 '' 是一个合法的筛选值（「只看没分类的」）
        .filter((p) => (category === null ? true : p.category === category))
      return HttpResponse.json({ projects: list })
    }),
    http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    http.get('/api/status', () => HttpResponse.json({ statuses: [] })),
  )
})

describe('「我自己的」筛选', () => {
  it('左栏只在真的有自己写的项目时出现这一项，并带上计数', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    const item = screen.getByRole('button', { name: /我自己的/ })
    expect(item.textContent).toContain('1')
  })

  it('点一下筛到自己的，再点一下取消（走服务端，不是前端过滤）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /我自己的/ }))
    await waitFor(() => expect(seen.some((q) => q.get('own') === '1')).toBe(true))
    await waitFor(() => expect(screen.queryByText('theirs')).toBeNull())
    expect(screen.getByText('mine')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /我自己的/ }))
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
  })

  it('与分类叠加：「我的 tools」是一个合理的查询，两个条件都发到服务端', async () => {
    useUiStore.setState({
      filters: { q: '', category: 'tools', tag: null, own: '1', attention: null, sort: null },
    })
    renderApp()

    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())
    const last = seen[seen.length - 1]!
    expect(last.get('own')).toBe('1')
    expect(last.get('category')).toBe('tools')
    // 选了分类之后清掉「我自己的」不该顺带发生——所以这一项仍然是开着的
    expect(useUiStore.getState().filters.category).toBe('tools')
    expect(useUiStore.getState().filters.own).toBe('1')
  })
})

/**
 * 清单行上的「我自己的」记号。
 *
 * 记号是**只读**的：可写字段只在「编辑资料」里改（STATUS.md 不变量 13），
 * 行里已经有铅笔了。这里要钉的是「看得见」——清单里两个仓库并排时，
 * 分不出哪个是自己的，那枚记号就白加了。
 */
describe('清单里的「我自己的」记号', () => {
  it('自己的项目有一枚记号，别人的没有', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())

    const marker = (name: string) => {
      const cell = screen.getByText(name).closest('td')
      return cell?.querySelector('[title="我自己的项目：批量检查默认跳过它"]') ?? null
    }
    expect(marker('mine')).toBeTruthy()
    expect(marker('theirs')).toBeNull()
  })

  it('记号是读屏能读到的，不只是给眼睛看的装饰', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())

    // 图标本身 aria-hidden（它只是图形），信息由紧邻的读屏专用文字给出
    const cell = screen.getByText('mine').closest('td')!
    expect(cell.querySelector('.sr-only')?.textContent).toBe('我自己的')
  })
})

/**
 * 侧栏与过滤面板是**两样东西**：
 *
 * ```
 * 清单页：| sidebar | filter panel | content |
 * 设置页：| sidebar | content |
 * ```
 *
 * 侧栏只有页面（点它换一页）；过滤面板是清单页自己的控件（点了只筛眼前这张
 * 表）。混在一列里时「分类」看起来像个能点过去的页面，点了却什么都不换——
 * 那种落差最难察觉。
 *
 * 而且过滤面板**只在清单页存在**：设置页那一栏只有侧栏，筛选没有对象可筛
 * （死控件比消失更糟：点了没反应，用户只会觉得这个应用卡了）。
 */
describe('侧栏只放页面，过滤项在另一条列', () => {
  function renderAt(path: string) {
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, gcTime: 0 } },
    })
    return render(<App />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    })
  }

  /**
   * 读 `aria-label` 而不是 `textContent`：侧栏现在是 60px 的图标栏，
   * **没有可见文字**——按屏幕上的字去查会拿到一堆空串。
   */
  const labelsIn = (sel: string) =>
    [...document.querySelectorAll(`${sel} a, ${sel} button`)].map(
      (e) => e.getAttribute('aria-label') ?? e.textContent!.trim(),
    )

  it('侧栏里只有两个页面，一个过滤项都没有', async () => {
    renderAt('/')
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
    expect(labelsIn('.nav')).toEqual(['清单', '设置'])
  })

  it('过滤面板是四段：仓库状态 / 我自己的 / 分类 / 标签', async () => {
    renderAt('/')
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    expect([...document.querySelectorAll('.filter-panel h2')].map((h) => h.textContent)).toEqual([
      '仓库状态',
      '我自己的',
      '分类',
      '标签',
    ])
    // 段标题**不与自己的取值重复**
    const labels = [...document.querySelectorAll('.filter-panel button')].map((b) =>
      b.textContent!.trim(),
    )
    expect(labels).toContain('我自己的1')
    expect(labels).not.toContain('我自己的')
    // 侧栏一个过滤项都没沾上
    expect(labelsIn('.nav')).toEqual(['清单', '设置'])
  })

  it('仓库状态五项的计数来自全量，不是筛选后的', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
    // 两个项目都是 ready
    const panel = document.querySelector('.filter-panel')!
    const text = [...panel.querySelectorAll('button')].map((b) => b.textContent!.trim())
    expect(text).toEqual(
      expect.arrayContaining(['全部仓库2', '可更新2', '已同步0', '不推荐0', '待检查0']),
    )
  })

  it('点「可更新」发 attention，再点一下取消', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^可更新/ }))
    await waitFor(() => expect(seen.some((q) => q.getAll('attention').includes('ready'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /^可更新/ }))
    await waitFor(() => expect(seen[seen.length - 1]!.getAll('attention').length).toBe(0))
  })

  it('「全部仓库」只清状态那一个维度，不动分类与标签', async () => {
    useUiStore.setState({
      filters: { q: '', category: 'tools', tag: null, own: '1', attention: 'ready', sort: null },
    })
    renderApp()
    // 开着 own=1 时 theirs 被筛掉了，列表里只剩 mine
    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^全部仓库/ }))
    const f = useUiStore.getState().filters
    expect(f.attention).toBeNull()
    expect(f.category).toBe('tools')
    expect(f.own).toBe('1')
  })

  it('「未分类」列出来而且点得动（不是死控件）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^未分类/ }))
    await waitFor(() => expect(seen[seen.length - 1]!.get('category')).toBe(''))
  })

  it('设置页：连过滤面板都没有（没有对象可筛）', async () => {
    renderAt('/settings')
    await waitFor(() => expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy())

    expect(document.querySelector('.filter-panel')).toBeNull()
    expect(labelsIn('.nav')).toEqual(['清单', '设置'])
  })
})

describe('「我自己的」筛选', () => {
  it('左栏只在真的有自己写的项目时出现这一项，并带上计数', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    const item = screen.getByRole('button', { name: /我自己的/ })
    expect(item.textContent).toContain('1')
  })

  it('点一下筛到自己的，再点一下取消（走服务端，不是前端过滤）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /我自己的/ }))
    await waitFor(() => expect(seen.some((q) => q.get('own') === '1')).toBe(true))
    await waitFor(() => expect(screen.queryByText('theirs')).toBeNull())
    expect(screen.getByText('mine')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /我自己的/ }))
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
  })

  it('与分类叠加：「我的 tools」是一个合理的查询，两个条件都发到服务端', async () => {
    useUiStore.setState({
      filters: { q: '', category: 'tools', tag: null, own: '1', attention: null, sort: null },
    })
    renderApp()

    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())
    const last = seen[seen.length - 1]!
    expect(last.get('own')).toBe('1')
    expect(last.get('category')).toBe('tools')
    // 选了分类之后清掉「我自己的」不该顺带发生——所以这一项仍然是开着的
    expect(useUiStore.getState().filters.category).toBe('tools')
    expect(useUiStore.getState().filters.own).toBe('1')
  })
})

/**
 * 清单行上的「我自己的」记号。
 *
 * 记号是**只读**的：可写字段只在「编辑资料」里改（STATUS.md 不变量 13），
 * 行里已经有铅笔了。这里要钉的是「看得见」——清单里两个仓库并排时，
 * 分不出哪个是自己的，那枚记号就白加了。
 */
describe('清单里的「我自己的」记号', () => {
  it('自己的项目有一枚记号，别人的没有', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())

    const marker = (name: string) => {
      const cell = screen.getByText(name).closest('td')
      return cell?.querySelector('[title="我自己的项目：批量检查默认跳过它"]') ?? null
    }
    expect(marker('mine')).toBeTruthy()
    expect(marker('theirs')).toBeNull()
  })

  it('记号是读屏能读到的，不只是给眼睛看的装饰', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())

    // 图标本身 aria-hidden（它只是图形），信息由紧邻的读屏专用文字给出
    const cell = screen.getByText('mine').closest('td')!
    expect(cell.querySelector('.sr-only')?.textContent).toBe('我自己的')
  })
})

/**
 * 侧栏与过滤面板是**两样东西**：
 *
 * ```
 * 清单页：| sidebar | filter panel | content |
 * 设置页：| sidebar | content |
 * ```
 *
 * 侧栏只有页面（点它换一页）；过滤面板是清单页自己的控件（点了只筛眼前这张
 * 表）。混在一列里时「分类」看起来像个能点过去的页面，点了却什么都不换——
 * 那种落差最难察觉。
 *
 * 而且过滤面板**只在清单页存在**：设置页那一栏只有侧栏，筛选没有对象可筛
 * （死控件比消失更糟：点了没反应，用户只会觉得这个应用卡了）。
 */
describe('侧栏只放页面，过滤项在另一条列', () => {
  function renderAt(path: string) {
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, gcTime: 0 } },
    })
    return render(<App />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    })
  }

  /**
   * 读 `aria-label` 而不是 `textContent`：侧栏现在是 60px 的图标栏，
   * **没有可见文字**——按屏幕上的字去查会拿到一堆空串。
   */
  const labelsIn = (sel: string) =>
    [...document.querySelectorAll(`${sel} a, ${sel} button`)].map(
      (e) => e.getAttribute('aria-label') ?? e.textContent!.trim(),
    )

  it('侧栏里只有两个页面，一个过滤项都没有', async () => {
    renderAt('/')
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
    expect(labelsIn('.nav')).toEqual(['清单', '设置'])
  })

  it('过滤面板是四段：仓库状态 / 我自己的 / 分类 / 标签', async () => {
    renderAt('/')
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    expect([...document.querySelectorAll('.filter-panel h2')].map((h) => h.textContent)).toEqual([
      '仓库状态',
      '我自己的',
      '分类',
      '标签',
    ])
    // 段标题**不与自己的取值重复**
    const labels = [...document.querySelectorAll('.filter-panel button')].map((b) =>
      b.textContent!.trim(),
    )
    expect(labels).toContain('我自己的1')
    expect(labels).not.toContain('我自己的')
    // 侧栏一个过滤项都没沾上
    expect(labelsIn('.nav')).toEqual(['清单', '设置'])
  })

  it('仓库状态五项的计数来自全量，不是筛选后的', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())
    // 两个项目都是 ready
    const panel = document.querySelector('.filter-panel')!
    const text = [...panel.querySelectorAll('button')].map((b) => b.textContent!.trim())
    expect(text).toEqual(
      expect.arrayContaining(['全部仓库2', '可更新2', '已同步0', '不推荐0', '待检查0']),
    )
  })

  it('点「可更新」发 attention，再点一下取消', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^可更新/ }))
    await waitFor(() => expect(seen.some((q) => q.getAll('attention').includes('ready'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /^可更新/ }))
    await waitFor(() => expect(seen[seen.length - 1]!.getAll('attention').length).toBe(0))
  })

  it('「全部仓库」只清状态那一个维度，不动分类与标签', async () => {
    useUiStore.setState({
      filters: { q: '', category: 'tools', tag: null, own: '1', attention: 'ready', sort: null },
    })
    renderApp()
    // 开着 own=1 时 theirs 被筛掉了，列表里只剩 mine
    await waitFor(() => expect(screen.getByText('mine')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^全部仓库/ }))
    const f = useUiStore.getState().filters
    expect(f.attention).toBeNull()
    expect(f.category).toBe('tools')
    expect(f.own).toBe('1')
  })

  it('「未分类」列出来而且点得动（不是死控件）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^未分类/ }))
    await waitFor(() => expect(seen[seen.length - 1]!.get('category')).toBe(''))
  })

  it('设置页：连过滤面板都没有（没有对象可筛）', async () => {
    renderAt('/settings')
    await waitFor(() => expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy())

    expect(document.querySelector('.filter-panel')).toBeNull()
    expect(labelsIn('.nav')).toEqual(['清单', '设置'])
  })
})

