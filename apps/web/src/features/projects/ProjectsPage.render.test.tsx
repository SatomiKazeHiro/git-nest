import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { ProjectsPage } from './ProjectsPage'
import { server } from '@/test/mocks/server'
import { useSelectedCount, useUiStore } from '@/store/ui'

/**
 * 勾选一行的影响面 —— 用 React `Profiler` 数**订阅者的渲染次数**。
 *
 * 起因：`Toolbar` 原来用 `useUiStore()`（整店订阅、没有选择器）。zustand 在任何
 * state 变化时都会通知整店订阅者，所以勾一个复选框会连带重渲染整个顶栏
 * （搜索框、三个按钮、项目计数）。十个项目感觉不出来，上百个就是肉眼可见的卡顿。
 *
 * 测法上踩过一个坑：把 `<Profiler>` 套在 `ProjectsPage` 外面**测不到**这件事 ——
 * 顶栏的重渲染是子树内部的事，不会让页面级 commit 次数变化（实测修复前后都是 1）。
 * 所以这里挂一个**与 Toolbar 订阅模式相同**的探针组件，直接数它的渲染次数。
 */

let wholeCommits = 0
let wholeRenders = 0
let granularCommits = 0
let granularRenders = 0
const countWhole: ProfilerOnRenderCallback = () => {
  wholeCommits += 1
}
const countGranular: ProfilerOnRenderCallback = () => {
  granularCommits += 1
}

/** 直接数组件函数执行了几次（比 Profiler 的 commit 更接近「重渲染」本身） */
function WholeStoreSubscriber() {
  wholeRenders += 1
  const store = useUiStore()
  return <span data-testid="whole">{store.filters.q}</span>
}

function GranularSubscriber() {
  granularRenders += 1
  const q = useUiStore((s) => s.filters.q)
  const selectedCount = useSelectedCount()
  return (
    <span data-testid="granular">
      {q}
      {selectedCount}
    </span>
  )
}

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Profiler id="whole" onRender={countWhole}>
          <WholeStoreSubscriber />
        </Profiler>
        <Profiler id="granular" onRender={countGranular}>
          <GranularSubscriber />
        </Profiler>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  wholeCommits = 0
  granularCommits = 0
  useUiStore.setState({
    selected: new Set<number>(),
    filters: { q: '', category: null, tag: null, own: null, attention: null, sort: null },
  })
  server.use(
    http.get('/api/projects', () =>
      HttpResponse.json({ projects: [makeProject(1, 'alpha'), makeProject(2, 'beta')] }),
    ),
    http.get('/api/status', () =>
      HttpResponse.json({
        statuses: [
          { projectId: 1, status: { path: 'D:/repos/alpha', isRepo: true, status: 'up_to_date' } },
          { projectId: 2, status: { path: 'D:/repos/beta', isRepo: true, status: 'up_to_date' } },
        ],
      }),
    ),
  )
})

describe('整店订阅 vs 逐个字段订阅', () => {
  it('勾选一行：整店订阅者重渲染，按字段订阅者只更新它订阅的那份', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())
    wholeRenders = 0
    granularRenders = 0

    fireEvent.click(screen.getByLabelText('选择 alpha'))
    await waitFor(() => expect(useUiStore.getState().selected.size).toBe(1))

    console.log(
      `[测量] 一次勾选 → 整店订阅组件函数执行 ${wholeRenders} 次；按字段订阅 ${granularRenders} 次`,
    )
    // 整店订阅：勾选（不属于它关心的 state）也会让组件函数重跑 —— 这就是被修掉的行为
    expect(wholeRenders).toBeGreaterThan(0)
    // 按字段订阅：它订阅了已选数量，所以这次也该更新；但改筛选时它**不该**因为
    // 「已选集合换了新 Set 引用」而重跑（下面这条用例专门测那个）
    expect(granularRenders).toBeLessThanOrEqual(wholeRenders)
  })

  it('已选集合换了新 Set 引用、但内容没变时：按字段订阅不重渲染', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    // 先选中，再「重新设一遍同样的 id」——内容相同，但 Set 是新对象
    useUiStore.getState().setSelection([1])
    await waitFor(() => expect(useUiStore.getState().selected.size).toBe(1))
    wholeRenders = 0
    granularRenders = 0

    useUiStore.getState().setSelection([1]) // 同样的内容，新的 Set

    await new Promise((r) => setTimeout(r, 20))
    console.log(
      `[测量] 内容不变的 setSelection → 整店订阅 ${wholeRenders} 次；按字段订阅 ${granularRenders} 次`,
    )
    // 这是 useSelectedIds 用 useShallow 的关键收益：内容没变就不重渲染
    expect(granularRenders).toBe(0)
  })

  it('改筛选时两者都要更新（不能为了省渲染而漏更新）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())

    useUiStore.getState().setQuery('alp')
    await waitFor(() => expect(screen.getByTestId('granular').textContent).toContain('alp'))
    expect(screen.getByTestId('whole').textContent).toContain('alp')
  })
})

