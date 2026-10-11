import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ProjectListItem } from '@git-nest/core'
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
  return render(
    <MemoryRouter>
      <ProjectTable
        projects={rows}
        statuses={undefined}
        currentId={null}
        isPending={false}
        onOpen={() => {}}
        onRemove={() => {}}
      />
    </MemoryRouter>,
  )
}

/** 表里从上到下的项目名（只取仓库那一格里的链接） */
function renderedNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('tbody .col-repo a')].map((a) => a.textContent ?? '')
}

beforeEach(() => {
  useUiStore.getState().clearFilters()
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

  it('没有排序键的列不是按钮（点了没反应的控件比没有更糟）', () => {
    renderTable(NAME_ORDERED)
    expect(screen.queryByRole('button', { name: /状态/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /当前分支/ })).toBeNull()
  })
})
