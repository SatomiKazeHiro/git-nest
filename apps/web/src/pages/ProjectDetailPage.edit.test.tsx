import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { RepoStatus } from '@git-nest/core'
import { server } from '@/test/mocks/server'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { useUiStore } from '@/store/ui'

/**
 * 「编辑资料 → 保存」这条链路的回归。
 *
 * 踩过的坑：`useInvalidate()` 里用 `queryKeys.project(0)`（＝`['project', 0]`）
 * 当「所有详情」的前缀。TanStack 的失效是**前缀匹配**，`['project', 0]` 匹配不到
 * `['project', 5]`（那是「没选中项目」时 `enabled: false` 的占位键），
 * 于是**任何写操作都失效不掉详情缓存**：保存成功后服务端已经返回新数据，
 * 详情页却一直显示旧记录，用户会以为改动丢了。
 *
 * 所以这里用真实渲染 + msw 走一遍，并数一次详情接口被取了几次：
 * 只改数据结构的测试（比如直接断言 key 数组）挡不住这类「键写得看着对、
 * 前缀匹配却不成立」的错误。
 */

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false, staleTime: 10_000, gcTime: 0 },
    },
  })
}

const baseProject = {
  id: 5,
  name: 'canvas-editor',
  path: 'D:/repos/canvas-editor',
  remoteUrl: 'https://example.invalid/canvas-editor.git',
  category: 'tools',
  record: '旧记录：在 B 站看到的',
  addedAt: '2026-10-01T00:00:00Z',
  sortOrder: 1,
  tags: [] as { id: number; name: string; color: string | null }[],
  latestCheck: null,
}

const okStatus: RepoStatus = {
  path: baseProject.path,
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
  behind: 0,
  remoteUrl: baseProject.remoteUrl,
  lastCommit: null,
  recommendation: null,
  status: 'up_to_date',
  error: null,
}

function renderDetail(client = makeClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/5']}>
        {/* 「编辑资料」弹窗挂在窗口外壳上（整个应用只此一份），
            这里按应用现在的真实接法把它带上——测的是保存后的失效链路，
            不是弹窗挂在哪一层。 */}
        <ProjectFormDialog />
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useUiStore.setState({ formOpen: false, editingId: null })
})

describe('编辑资料保存后，详情页要跟着更新', () => {
  it('保存成功后重新取数，页面显示新记录', async () => {
    let current = { ...baseProject }
    let detailGets = 0

    server.use(
      http.get('/api/projects/5', () => {
        detailGets += 1
        return HttpResponse.json({ project: current })
      }),
      http.patch('/api/projects/5', async ({ request }) => {
        current = { ...current, ...((await request.json()) as object) }
        return HttpResponse.json({ project: current })
      }),
      http.get('/api/projects/5/status', () => HttpResponse.json({ status: okStatus })),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )

    renderDetail()
    await waitFor(() => expect(screen.getByText(/旧记录/)).toBeTruthy())
    const getsBefore = detailGets

    fireEvent.click(screen.getByText('编辑资料'))
    const box = (await screen.findByDisplayValue(/旧记录/)) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '新记录：改过了' } })
    fireEvent.click(screen.getByText('保存改动'))

    // 保存后必须**重新取一次**详情（失效键前缀对不上时不会取）
    await waitFor(() => expect(detailGets).toBeGreaterThan(getsBefore))
    await waitFor(() => expect(screen.getByText(/新记录/)).toBeTruthy())
    expect(screen.queryByText(/旧记录/)).toBeNull()
  })
})

describe('目录不在了 / 读不出来，不许说成「不是 git 仓库」', () => {
  function renderWithStatus(status: RepoStatus) {
    server.use(
      http.get('/api/projects/5', () => HttpResponse.json({ project: baseProject })),
      http.get('/api/projects/5/status', () => HttpResponse.json({ status })),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )
    return renderDetail()
  }

  it('missing：摘要行说的是「目录不在了」，与页面顶部横幅一致', async () => {
    renderWithStatus({
      ...okStatus,
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      status: 'missing',
      error: { kind: 'missing', message: '目录不在了' },
    })

    const line = await screen.findByTestId('status-summary')
    expect(line.textContent).toContain('目录不在了')
    expect(line.textContent).not.toContain('不是 git 仓库')
  })

  it('error（路径过长 / 读不出来）：照原样说「读不出状态」，不冒充确定结论', async () => {
    renderWithStatus({
      ...okStatus,
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      status: 'error',
      error: { kind: 'path_too_long', message: '路径 258 个字符，git 进不去' },
    })

    const line = await screen.findByTestId('status-summary')
    expect(line.textContent).toContain('读不出状态')
    expect(line.textContent).not.toContain('不是 git 仓库')
  })
})
