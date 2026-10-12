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

/**
 * 分类那一行的**图标**。
 *
 * 用户的原始疑问是「设置里有图标、左栏却没有」——根因是那个 `Item` 从来没收到图标。
 * 这里钉住它的两种结局：认得出就画（一个 svg），认不出就**什么都不画**
 * （不塞占位图，那会让人以为这个分类本来就有个图标）。
 *
 * 只断言 svg 的有无、不断言是哪一个组件：那是 `icons.tsx` 那张表的事，
 * 换了图标不该让左栏的用例跟着红。
 */
describe('FilterPanel · 分类项的图标', () => {
  const withIcon = (icon: string | null) => {
    server.use(
      http.get('/api/categories', () =>
        HttpResponse.json({
          categories: [
            ...builtinCategoryList(),
            { key: 'zebra', label: 'AI 项目', icon, builtin: false, projectCount: 1 },
          ],
        }),
      ),
      http.get('/api/projects', () =>
        HttpResponse.json({ projects: [project('zebra')], total: 1 }),
      ),
    )
  }

  it('认得出图标：那一项里画出来', async () => {
    withIcon('brain')
    renderPanel()

    const row = await screen.findByRole('button', { name: /AI 项目/ })
    expect(row.querySelector('svg')).not.toBeNull()
  })

  it('**未知 key 不渲染任何东西**（名单外的名字不塞占位图）', async () => {
    withIcon('not-a-real-icon')
    renderPanel()

    const row = await screen.findByRole('button', { name: /AI 项目/ })
    expect(row.querySelector('svg')).toBeNull()
  })

  it('没设图标同样什么都不画', async () => {
    withIcon(null)
    renderPanel()

    const row = await screen.findByRole('button', { name: /AI 项目/ })
    expect(row.querySelector('svg')).toBeNull()
  })
})
