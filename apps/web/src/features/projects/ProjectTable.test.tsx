import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { builtinCategoryList, type ProjectListItem } from '@git-nest/core'
import { server } from '@/test/mocks/server'
import { useUiStore } from '@/store/ui'
import { ProjectTable } from './ProjectTable'

/**
 * 清单表的排序语义。
 *
 * 这里钉两件事，都是「两处各做一半」造成的：
 *
 * 1. **客户端按分类分组只在「默认」排序时做。** 服务端为 `sort=name` 特意返回
 *    纯名称序（那边有测试），而这里以前**无条件**再按分类切一遍——于是按名称
 *    变成「先分类再名称」，跨类上和「默认」长得一样：下拉说的和排出来的不一样。
 * 2. **表头可点**，且第一次点得到的方向与下拉一致（`DEFAULT_SORT_DIR`）。
 *
 * 夹具刻意让两种顺序**不一样**，否则断言没有鉴别力（第一版就是两个都写成了
 * 同一个顺序，两条用例谁也测不出来）。
 */
const project = (id: number, name: string, category: string): ProjectListItem =>
  ({
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
    lastAttempt: null,
    attention: 'unchecked',
    hasLogo: false,
    projectType: null,
  }) as ProjectListItem

/**
 * `sort=name` 时服务端会给的序：**纯名称序**，分类交错（aaa/web 夹在 ccc/app 中间）。
 * 客户端要是再按分类切一遍，就会变成「ccc、aaa、bbb」——两者一眼可分。
 */
const NAME_ORDERED = [
  project(2, 'aaa', 'app'),
  project(3, 'bbb', 'web'),
  project(1, 'ccc', 'app'),
]

/** 默认序下服务端会给的序。故意不是分组好的：分组是客户端按**显示名**重排的事。 */
const UNSORTED = [
  project(1, 'ccc', 'web'),
  project(2, 'aaa', 'app'),
  project(3, 'bbb', 'web'),
]

function renderTable(rows: ProjectListItem[]) {
  // 表格要读分类名单（按**显示名**分组排序），所以得有 query client；
  // 名单本身走 `test/mocks/server.ts` 的默认 handler（内置四个）
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectTable
          projects={rows}
          statuses={undefined}
          currentId={null}
          isPending={false}
          onOpen={() => {}}
          onRemove={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** 表里从上到下的项目名（只取仓库那一格里的链接） */
function renderedNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('tbody .col-repo a')].map((a) => a.textContent ?? '')
}

beforeEach(() => {
  useUiStore.getState().clearFilters()
  /*
    空状态那条用例会按按钮，按下去就改这两个开关。**每条用例都从「都关着」开始**：
    store 是模块级单例，上一个文件/用例留下的 `formOpen: true` 会让
    「点了才打开」这类断言失去鉴别力（本来就已经是 true 了）。
  */
  useUiStore.setState({ scanOpen: false, formOpen: false, editingId: null })
})

describe('ProjectTable · 默认序（sort = null）', () => {
  it('按分类分组：同类连在一起（分组之间按**显示名**排，不是存进库的英文）', () => {
    const { container } = renderTable(UNSORTED)

    // app [aaa] → web [ccc、bbb]（组内保持服务端给的序）
    expect(renderedNames(container)).toEqual(['aaa', 'ccc', 'bbb'])
  })
})

describe('ProjectTable · 显式排序', () => {
  it('**服务端给的序原样保留**，不再按分类重排（按名称就该是纯名称序）', () => {
    useUiStore.getState().setSort('name')
    const { container } = renderTable(NAME_ORDERED)

    expect(renderedNames(container)).toEqual(['aaa', 'bbb', 'ccc'])
  })
})

describe('ProjectTable · 表头可点', () => {
  it('第一次点：设成这个键 + 它的默认方向（名称升序）', () => {
    renderTable(NAME_ORDERED)
    fireEvent.click(screen.getByRole('button', { name: /仓库/ }))

    expect(useUiStore.getState().filters.sort).toBe('name')
    expect(useUiStore.getState().filters.dir).toBe('asc')
  })

  it('再点同一个：翻方向', () => {
    renderTable(NAME_ORDERED)
    const header = screen.getByRole('button', { name: /仓库/ })
    fireEvent.click(header)
    fireEvent.click(header)

    expect(useUiStore.getState().filters.sort).toBe('name')
    expect(useUiStore.getState().filters.dir).toBe('desc')
  })

  it('**三次点击是一个循环**：默认方向 → 反向 → 复位（回到初始）', () => {
    renderTable(NAME_ORDERED)
    const header = screen.getByRole('button', { name: /仓库/ })

    fireEvent.click(header)
    expect(useUiStore.getState().filters).toMatchObject({ sort: 'name', dir: 'asc' })

    fireEvent.click(header)
    expect(useUiStore.getState().filters).toMatchObject({ sort: 'name', dir: 'desc' })

    // 复位：**连排序键一起清掉**——只清方向的话「没排序」和「按某个键排」就分不开了
    fireEvent.click(header)
    expect(useUiStore.getState().filters.sort).toBeNull()
    expect(useUiStore.getState().filters.dir).toBeNull()

    // 复位之后表头也不再自称在排
    expect(header.closest('th')?.getAttribute('aria-sort')).toBe('none')
  })

  it('默认方向是**降序**的列走同一个三步：降序 → 升序 → 复位', () => {
    renderTable(NAME_ORDERED)
    const header = screen.getByRole('button', { name: /差异/ })

    fireEvent.click(header)
    expect(useUiStore.getState().filters).toMatchObject({ sort: 'behind', dir: 'desc' })

    fireEvent.click(header)
    expect(useUiStore.getState().filters).toMatchObject({ sort: 'behind', dir: 'asc' })

    fireEvent.click(header)
    expect(useUiStore.getState().filters.sort).toBeNull()
  })

  it('点另一列：换成那一列，并回到**它自己的**默认方向（落后数是降序）', () => {
    useUiStore.getState().setSort('name')
    renderTable(NAME_ORDERED)
    fireEvent.click(screen.getByRole('button', { name: /差异/ }))

    expect(useUiStore.getState().filters.sort).toBe('behind')
    expect(useUiStore.getState().filters.dir).toBe('desc')
  })

  it('`aria-sort` 跟着走：读屏要能说出这一列正按什么排', () => {
    useUiStore.getState().setSort('name', 'desc')
    const { container } = renderTable(NAME_ORDERED)

    expect(container.querySelector('th.col-repo')?.getAttribute('aria-sort')).toBe('descending')
    // 没在排的列是 none，而不是不给这个属性（不给的话读屏念不出「没有排序」）
    expect(container.querySelector('th.col-checked')?.getAttribute('aria-sort')).toBe('none')
  })

  it('换列时**旧列复位**：同一时刻只有一列在排', () => {
    renderTable(NAME_ORDERED)
    fireEvent.click(screen.getByRole('button', { name: /仓库/ }))
    fireEvent.click(screen.getByRole('button', { name: /差异/ }))

    // store 里只剩最新选的那一个键
    expect(useUiStore.getState().filters.sort).toBe('behind')
    expect(useUiStore.getState().filters.dir).toBe('desc')

    // 旧列不再自称在排序：箭头没了、aria-sort 回到 none
    const repoTh = screen.getByRole('button', { name: /仓库/ }).closest('th')
    expect(repoTh?.getAttribute('aria-sort')).toBe('none')
    expect(repoTh?.querySelector('svg')).toBeNull()

    // 新列接上
    const deltaTh = screen.getByRole('button', { name: /差异/ }).closest('th')
    expect(deltaTh?.getAttribute('aria-sort')).toBe('descending')
    expect(deltaTh?.querySelector('svg')).not.toBeNull()
  })

  it('没有排序键的列不是按钮（点了没反应的控件比没有更糟）', () => {
    renderTable(NAME_ORDERED)
    expect(screen.queryByRole('button', { name: /当前分支/ })).toBeNull()
  })

  it('状态列可排：第一次点用它的默认方向（行动优先 = 升序）', () => {
    renderTable(NAME_ORDERED)
    fireEvent.click(screen.getByRole('button', { name: /^状态/ }))

    expect(useUiStore.getState().filters.sort).toBe('attention')
    expect(useUiStore.getState().filters.dir).toBe('asc')
  })
})

/**
 * 默认序里「同类连在一起」是按**显示名**排的（和左栏同一套）。
 *
 * 分类变成可配置的之后，显示名不再写在 core 的静态表里，而是配置里读出来的——
 * 所以夹具必须让「按 key 排」与「按显示名排」**给出不同的顺序**，否则这条用例
 * 没有鉴别力：`zebra` 这个 key 排在 `tools` 后面，而它的显示名「AI 项目」排在
 * 「工具」前面。
 */
describe('ProjectTable · 默认序按分类的显示名分组', () => {
  it('用户自建的分类按它的 label 排，不按 key', async () => {
    server.use(
      http.get('/api/categories', () =>
        HttpResponse.json({
          categories: [
            ...builtinCategoryList(),
            { key: 'zebra', label: 'AI 项目', icon: null, builtin: false, projectCount: 1 },
          ],
        }),
      ),
    )

    // 服务端给的序是 tools 在前；按显示名重排之后，「AI 项目」那一组要排到「工具」前面。
    // **表里没有分区行**（分类只是排序依据，见组件的注释），所以这里等的是**行序**，
    // 不是等某段文字出现。
    const { container } = renderTable([
      project(1, 'tools-one', 'tools'),
      project(2, 'zebra-one', 'zebra'),
    ])

    await waitFor(() => {
      expect(renderedNames(container)).toEqual(['zebra-one', 'tools-one'])
    })
  })
})

/**
 * 空清单那两枚动作。
 *
 * 原来只有「添加第一个项目」，而**首次使用的人更可能想扫描**：仓库已经在本机了，
 * 一个个手填路径是把已知的东西重新打一遍。补上的那一枚不是新做的功能——`openScan`
 * 早就是设置里一个独立弹窗、工具条上也有同一个入口——它只是在这条路上多给一个入口。
 *
 * 「扫描目录」的措辞必须与工具条**逐字一致**：同一个动作在两个地方叫两个名字，
 * 用户会以为它们不一样。
 */
describe('ProjectTable · 空清单状态', () => {
  it('两枚动作都在：「添加第一个项目」与「扫描目录」', () => {
    renderTable([])

    expect(screen.getByRole('button', { name: '添加第一个项目' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '扫描目录' })).toBeTruthy()
  })

  it('点「扫描目录」就把扫描弹窗打开（不是跳路由、也不打开添加表单）', () => {
    renderTable([])
    fireEvent.click(screen.getByRole('button', { name: '扫描目录' }))

    expect(useUiStore.getState().scanOpen).toBe(true)
    // 别顺带把添加表单也打开：那是另一枚按钮的事
    expect(useUiStore.getState().formOpen).toBe(false)
  })

  it('「添加第一个项目」照旧打开添加表单，且不动扫描开关', () => {
    renderTable([])
    fireEvent.click(screen.getByRole('button', { name: '添加第一个项目' }))

    expect(useUiStore.getState().formOpen).toBe(true)
    expect(useUiStore.getState().scanOpen).toBe(false)
  })
})
