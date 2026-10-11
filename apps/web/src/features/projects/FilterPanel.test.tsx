import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { builtinCategoryList, type ProjectListItem } from '@git-nest/core'
import { server } from '@/test/mocks/server'
import { useUiStore } from '@/store/ui'
import { FilterPanel } from './FilterPanel'

/**
 * 左栏「分类」那一段显示的是**配置里的 label**，不是 key。
 *
 * 由来：分类从编译期的枚举变成用户可以自己加的名单之后，那一段一度还在用静态的
 * 翻译表 → 用户建一个叫「AI 项目」的分类（key 是服务端生成的 `ai`），左栏里就会
 * 出现 `ai` 这种 key。这条用例就是钉这件事：**看到的是名字，不是标识符**。
 *
 * 夹具刻意让两者不同（`zebra` / 「AI 项目」），并且额外断言 key **不该**出现在
 * 界面上——只断言「有 AI 项目」的话，一个既显示 key 又显示 label 的实现也能过。
 */
const project = (category: string): ProjectListItem =>
  ({
    id: 1,
    name: 'one',
    path: 'D:/repos/one',
    remoteUrl: null,
    isOwn: false,
    category,
    record: '',
    addedAt: '2026-10-01T00:00:00Z',
    sortOrder: 1,
    tags: [],
    latestCheck: null,
    attention: 'unchecked',
    hasLogo: false,
    projectType: null,
  }) as ProjectListItem

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <FilterPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useUiStore.getState().clearFilters()
})

describe('FilterPanel · 分类那一行', () => {
  it('显示配置里的 label；key 不出现在界面上', async () => {
    server.use(
      http.get('/api/categories', () =>
        HttpResponse.json({
          categories: [
            ...builtinCategoryList(),
            { key: 'zebra', label: 'AI 项目', icon: null, builtin: false, projectCount: 1 },
          ],
        }),
      ),
      http.get('/api/projects', () =>
        HttpResponse.json({ projects: [project('zebra')], total: 1 }),
      ),
    )

    renderPanel()

    expect(await screen.findByRole('button', { name: /AI 项目/ })).toBeTruthy()
    expect(screen.queryByText('zebra')).toBeNull()
  })
})
