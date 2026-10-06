import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { server } from '@/test/mocks/server'
import { App } from '@/App'
import { useUiStore } from '@/store/ui'

/**
 * 桌面键盘操作。
 *
 * 清单页原先只能用鼠标：点复选框、点名称、点按钮。桌面软件的清单表是键盘优先的，
 * 而「键盘能用」和「键盘不会误伤」是两件事——这里钉的是后者，三个坑各一条：
 *
 * 1. **Space 的双翻转。** 行焦点在 `<tr>` 上时我们处理 Space；但焦点在那个
 *    真的 `<input type=checkbox>` 上时，浏览器自己会切换它，我们再来一次就
 *    反了（按一下没反应，或者勾上又立刻取消）。所以按元件类型让位。
 * 2. **Ctrl+A 的劫持。** 焦点在搜索框里时，Ctrl+A 必须还是「选中这段文字」，
 *    不能变成「勾选清单里全部行」——那种劫持用户几乎发现不了，只会觉得搜索框
 *    有点怪。
 * 3. **弹窗开着时的穿透。** 在更新报告弹窗里按 Ctrl+A，用户想全选的是弹窗里
 *    那一列；实际被全选的是**背后那张清单**，而屏幕上没有任何东西提示过这件事。
 */

function makeProject(id: number, name: string) {
  return {
    id,
    name,
    path: `D:/repos/${name}`,
    remoteUrl: null,
    category: 'tools',
    record: '',
    addedAt: '2026-10-01T00:00:00Z',
    sortOrder: id,
    tags: [],
    latestCheck: null,
  }
}

function makeStatus() {
  return {
    path: 'D:/repos/demo',
    checkedAt: '2026-10-05T00:00:00Z',
    isRepo: true,
    branch: 'main',
    detached: false,
    dirty: false,
    dirtyCount: 0,
    dirtyTracked: 0,
    dirtyUntracked: 0,
    upstream: 'origin/main',
    upstreamGone: false,
    ahead: 0,
    behind: 3,
    remoteUrl: null,
    lastCommit: null,
    recommendation: null,
    status: 'behind',
    error: null,
  }
}

/** 把当前地址显示出来，Enter / 菜单跳转才有得断言 */
function Location() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Location />
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null },
    formOpen: false,
    editingId: null,
    navOpen: true,
    detailOpen: true,
  })
  server.use(
    http.get('/api/projects', () =>
      HttpResponse.json({ projects: [makeProject(1, 'alpha'), makeProject(2, 'beta')] }),
    ),
    http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    http.get('/api/status', () =>
      HttpResponse.json({
        statuses: [
          { projectId: 1, status: makeStatus() },
          { projectId: 2, status: makeStatus() },
        ],
      }),
    ),
    http.get('/api/projects/:id', () => HttpResponse.json({ project: makeProject(1, 'alpha') })),
    http.get('/api/projects/:id/status', () => HttpResponse.json({ status: makeStatus() })),
  )
})

/** 两条固定顺序的行（beforeEach 里始终是 alpha、beta） */
async function rows(): Promise<[HTMLElement, HTMLElement]> {
  renderApp()
  await screen.findByText('alpha')
  const r = [...document.querySelectorAll('tbody tr')] as HTMLElement[]
  return [r[0]!, r[1]!]
}

describe('行内按键', () => {
  it('行焦点上的 Space 只切换一次', async () => {
    const [alpha] = await rows()
    alpha.focus()

    fireEvent.keyDown(alpha, { key: ' ' })

    await waitFor(() => expect(useUiStore.getState().selected.has(1)).toBe(true))
    expect(useUiStore.getState().selected.size).toBe(1)
  })

  it('Space 在勾选框上时交给浏览器，我们不插手（否则就是双翻转）', async () => {
    const [alpha] = await rows()
    const box = alpha.querySelector('input[type=checkbox]') as HTMLElement

    fireEvent.keyDown(box, { key: ' ' })

    // 我们的处理器没动过选中集合。真实浏览器里这一步是 input 自己切换的，
    // jsdom 不实现键盘的默认行为，所以这里只能断言「我们没有掺和」——
    // 而这正是双翻转的必要条件。
    expect(useUiStore.getState().selected.size).toBe(0)
  })

  it('↓ 把行焦点往下移，↑ 移回来', async () => {
    const [alpha, beta] = await rows()
    alpha.focus()

    fireEvent.keyDown(alpha, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(beta)

    fireEvent.keyDown(beta, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(alpha)
  })

  it('Enter 在右栏打开这一行（地址变了，不是新开一页）', async () => {
    const [, beta] = await rows()
    beta.focus()

    fireEvent.keyDown(beta, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/projects/2'))
  })

  it('Delete 走的是「先问一句」的那条路，不直接删', async () => {
    const [, beta] = await rows()
    beta.focus()

    fireEvent.keyDown(beta, { key: 'Delete' })

    // 出现的是确认弹窗，磁盘上的仓库与清单记录都还没动
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/把 beta 移出清单？/)).toBeTruthy()
  })
})

describe('全局快捷键', () => {
  it('Ctrl+A 勾选当前清单的全部行', async () => {
    await rows()

    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })

    await waitFor(() => expect(useUiStore.getState().selected.size).toBe(2))
  })

  it('焦点在搜索框里时 Ctrl+A 不劫持（那必须还是「选中这段文字」）', async () => {
    await rows()
    const search = screen.getByLabelText('搜索项目') as HTMLInputElement
    search.focus()

    fireEvent.keyDown(search, { key: 'a', ctrlKey: true })

    expect(useUiStore.getState().selected.size).toBe(0)
  })

  it('弹窗开着时 Ctrl+A 穿不过去', async () => {
    await rows()
    // 打开「编辑资料」弹窗
    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })

    // 背后那张清单一个都没被勾上
    expect(useUiStore.getState().selected.size).toBe(0)
  })

  it('Ctrl+F 把焦点送到搜索框', async () => {
    await rows()

    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })

    expect(document.activeElement).toBe(screen.getByLabelText('搜索项目'))
  })

  it('没人接手的组合键不拦截：浏览器自己的快捷键照常工作', async () => {
    await rows()

    // Ctrl+R（刷新）没绑命令。挡掉它等于让这个应用吞掉浏览器的刷新，
    // 而它跟这个应用毫无关系——这是「全局键盘处理器」最容易犯的错。
    const ev = new KeyboardEvent('keydown', {
      key: 'r',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(false)
  })
})
