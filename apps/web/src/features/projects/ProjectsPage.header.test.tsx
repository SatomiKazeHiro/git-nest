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
 * 工具条下面那一行：状态 / 分组 / 排序三个下拉 + 全选。
 *
 * 钉住的是三件容易写坏的事：
 *
 * 1. **与左栏是同一份筛选状态。** 两边都留着是为了对比（决定 8），所以它们
 *    必须读写同一个 `filters`；各存一份的话，改了这边另一边不亮，用户会以为
 *    两个筛选器各筛各的。
 * 2. **「未分类」在下拉里要能被选出来。** 它在库里的值是空串，而「全部」也需要
 *    一个值——两个选项共用空串时，选了「未分类」下拉会显示成「全部」，筛的却是
 *    空串：控件说的和做的不一致。
 * 3. **全选选的是「当前筛出来的这些行」**，不是库里全部。
 */

function makeProject(id: number, name: string, category: string, attention = 'ready') {
  return {
    id,
    name,
    path: `D:/repos/${name}`,
    remoteUrl: null,
    isOwn: false,
    category,
    record: '',
    addedAt: '2026-10-01T00:00:00Z',
    sortOrder: id,
    tags: [],
    latestCheck: null,
    attention,
  }
}

const ALL = [
  makeProject(1, 'alpha', 'tools'),
  makeProject(2, 'beta', ''),
  makeProject(3, 'gamma', 'tools', 'synced'),
]

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
      const category = url.searchParams.get('category')
      const attention = url.searchParams.get('attention')
      const list = ALL
        // `!== null` 而不是真值：缺席是 null、显式空串是 ''，而 '' 是合法取值
        .filter((p) => (category === null ? true : p.category === category))
        .filter((p) => (attention === null ? true : p.attention === attention))
      return HttpResponse.json({ projects: list, total: list.length })
    }),
    http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    http.get('/api/status', () => HttpResponse.json({ statuses: [] })),
  )
})

describe('列表头', () => {
  it('有状态 / 分组 / 排序三个下拉与一个全选', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    expect(screen.getByRole('combobox', { name: '状态' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '分组' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '排序' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeTruthy()
  })

  it('排序下拉真的改变请求参数', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'behind' } })
    // 用 `some` 而不是「最后一次请求」：`/api/projects` 还有一条侧栏的全量计数
    // 请求也在记，谁最后落地不该决定断言成不成立
    await waitFor(() => expect(seen.some((q) => q.get('sort') === 'behind')).toBe(true))
  })

  it('状态下拉与左栏是同一份筛选状态（决定 8：两边都留着对比）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.change(screen.getByRole('combobox', { name: '状态' }), { target: { value: 'blocked' } })
    await waitFor(() => expect(useUiStore.getState().filters.attention).toBe('blocked'))
    // 左栏那一项随之高亮
    expect(screen.getByRole('button', { name: /^不推荐/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('左栏改状态，下拉也跟着变（同一份状态的另一半方向）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^可更新/ }))
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: '状态' }) as HTMLSelectElement).value).toBe(
        'ready',
      ),
    )
  })

  it('「未分类」在分组下拉里选得出来，而且下拉不说成「全部」', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.change(screen.getByRole('combobox', { name: '分组' }), { target: { value: '' } })
    await waitFor(() => expect(seen.some((q) => q.get('category') === '')).toBe(true))

    // 关键：筛的是「没分类的」，下拉却显示「全部」的话，控件说的和做的不一致
    const sel = screen.getByRole('combobox', { name: '分组' }) as HTMLSelectElement
    expect(sel.value).toBe('')
    expect(screen.getByText('beta')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
  })

  it('全选选的是当前筛出来的这些行', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    // 先筛到 tools（两个项目），再全选——不该把被筛掉的 beta 也选上。
    // 查询限定在过滤面板里：标题栏也有一个叫「工具」的菜单按钮，按名字全局查会撞
    const panel = document.querySelector('.filter-panel')!
    const toolsBtn = [...panel.querySelectorAll('button')].find((b) =>
      b.textContent!.startsWith('工具'),
    )!
    fireEvent.click(toolsBtn)
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    await waitFor(() => expect(useUiStore.getState().selected.size).toBe(2))
    expect([...useUiStore.getState().selected].sort()).toEqual([1, 3])
  })

  it('没有筛选时也能全选', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    await waitFor(() => expect(useUiStore.getState().selected.size).toBe(3))
  })

  it('筛选生效时工具条出现「清掉筛选」，且它也认未分类（空串）', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /清掉筛选/ })).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: '分组' }), { target: { value: '' } })
    // 真值判断会把空串当成「没筛选」，于是这个按钮不出现，用户清不掉
    await waitFor(() => expect(screen.getByRole('button', { name: /清掉筛选/ })).toBeTruthy())
  })
})