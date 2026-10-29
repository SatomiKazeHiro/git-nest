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
  // 「最近一次尝试」；详情页的用例不关心它，但接口形状里它是必有的
  lastAttempt: null,
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

    // 「编辑资料」已收成纯图标按钮，文字在 title 里（可访问名认 title 兜底）
    fireEvent.click(screen.getByRole('button', { name: /编辑资料/ }))
    const box = (await screen.findByDisplayValue(/旧记录/)) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '新记录：改过了' } })
    fireEvent.click(screen.getByText('保存改动'))

    // 保存后必须**重新取一次**详情（失效键前缀对不上时不会取）
    await waitFor(() => expect(detailGets).toBeGreaterThan(getsBefore))
    await waitFor(() => expect(screen.getByText(/新记录/)).toBeTruthy())
    expect(screen.queryByText(/旧记录/)).toBeNull()
  })
})

describe('详情卡里的「更新」只在该出现的时候出现', () => {
  /*
    判据是 `canPull`（判决 safe **且**确实落后）：不是「落后 > 0」，也不是「判决 safe」
    ——「已是最新」也是 safe，但它没有东西可拉。

    不该出现的时候**不出现禁用态**：一个按下去只会被服务端跳过的按钮就是死控件。
    所以这里断言的是「按钮在不在」，不是「disabled 是不是 true」。
  */
  function renderWithRecommendation(recommendation: RepoStatus['recommendation']) {
    server.use(
      http.get('/api/projects/5', () => HttpResponse.json({ project: baseProject })),
      http.get('/api/projects/5/status', () =>
        HttpResponse.json({
          status: {
            ...okStatus,
            behind: recommendation?.behind ?? 0,
            ahead: recommendation?.ahead ?? 0,
            status: recommendation?.canPull ? 'behind' : 'up_to_date',
            recommendation,
          },
        }),
      ),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )
    return renderDetail()
  }

  it('能干净快进（safe + 落后）：给「更新」，而且是主按钮（蓝）', async () => {
    renderWithRecommendation({
      verdict: 'safe',
      ahead: 0,
      behind: 22,
      canPull: true,
      reason: '可以直接快进到远程的 22 个提交。',
    })

    const update = await screen.findByRole('button', { name: '更新' })
    expect(update.className).toContain('bg-accent')
    // 三枚动作都在，顺序是「动手的 → 先问远程的 → 只重读的」
    expect(screen.getByRole('button', { name: /联网同步/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /重读本地状态/ })).toBeTruthy()
  })

  it('已是最新（safe 但不能拉）：不给「更新」，免得按下去只会被跳过', async () => {
    renderWithRecommendation({
      verdict: 'safe',
      ahead: 0,
      behind: 0,
      canPull: false,
      reason: '已是最新，没有要拉的。',
    })

    await screen.findByTestId('status-summary')
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull()
  })

  it('别拉（rewritten）：不给「更新」', async () => {
    renderWithRecommendation({
      verdict: 'rewritten',
      ahead: null,
      behind: null,
      canPull: false,
      reason: '上游历史被改写过。',
    })

    await screen.findByTestId('status-summary')
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull()
  })
})

describe('「不用动」的时候，同一句话不说两遍', () => {
  /*
    状态卡的依据行写着「已是最新」，而 core 给这一档的理由也叫「已是最新，没有要拉的。」
    ——同一件事在两张字号上各写一遍，读起来像界面重复渲染了一次。判据是数据
    （`safe` + 不能拉 + 两边都没多出提交），不是匹配文案，所以这条测试钉的是
    「那一条数据组合下不出现理由」，不是某个字符串。
  */
  it('已是最新：状态词已经说了，理由那句不再出现', async () => {
    server.use(
      http.get('/api/projects/5', () =>
        HttpResponse.json({
          project: {
            ...baseProject,
            latestCheck: { checkedAt: '2026-10-18T06:30:00Z', status: 'up_to_date' },
          },
        }),
      ),
      http.get('/api/projects/5/status', () =>
        HttpResponse.json({
          status: {
            ...okStatus,
            recommendation: {
              verdict: 'safe',
              ahead: 0,
              behind: 0,
              canPull: false,
              reason: '已是最新，没有要拉的。',
            },
          },
        }),
      ),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )

    renderDetail()
    const card = await screen.findByTestId('status-summary')
    // 卡顶那个词走行动分类那一套（和清单的药丸、左栏同一份词表）：
    // 「safe 但没有可拉的」是**已同步**，不是判决表里的「可更新」
    // 这次检查已是 7 天前（stale），状态词要带限定语「上次看是最新」（text.ts 的
    // 话术降级：陈旧的远程结论不许说成肯定的「已是最新」）
    expect(card.textContent).toContain('已同步')
    expect(card.textContent).toContain('上次看是最新')
    expect(card.textContent).not.toContain('没有要拉的')
  })
  it('分叉：卡顶说「需要确认」，和清单那枚药丸同一个词', async () => {
    server.use(
      http.get('/api/projects/5', () => HttpResponse.json({ project: baseProject })),
      http.get('/api/projects/5/status', () =>
        HttpResponse.json({
          status: {
            ...okStatus,
            ahead: 3,
            behind: 2,
            status: 'diverged',
            recommendation: {
              verdict: 'diverged',
              ahead: 3,
              behind: 2,
              canPull: false,
              reason: '上游和本地都往前走了，不能快进，需要你自己决定怎么合。',
            },
          },
        }),
      ),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )

    renderDetail()
    const card = await screen.findByTestId('status-summary')
    // 判决表里这一档叫「要你决定」，但卡顶跟清单、左栏共用行动分类的词
    expect(card.textContent).toContain('需要确认')
    expect(card.textContent).not.toContain('要你决定')
    // 事实那句还在，两个方向都写清楚
    expect(card.textContent).toContain('已分叉')
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

  it('目录不在了、库里还留着上次远程检查：不许把那次检查的时间挂上来', async () => {
    // 那次检查属于「这个目录还在」的时候。挂在「目录不在了」旁边，读起来像刚查过它。
    server.use(
      http.get('/api/projects/5', () =>
        HttpResponse.json({
          project: {
            ...baseProject,
            latestCheck: { checkedAt: '2026-10-18T06:30:00Z', status: 'up_to_date' },
          },
        }),
      ),
      http.get('/api/projects/5/status', () =>
        HttpResponse.json({
          status: {
            ...okStatus,
            isRepo: false,
            branch: null,
            upstream: null,
            ahead: null,
            behind: null,
            lastCommit: null,
            status: 'missing',
            error: { kind: 'missing', message: '目录不在了' },
          },
        }),
      ),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )

    renderDetail()
    const line = await screen.findByTestId('status-summary')
    expect(line.textContent).toContain('目录不在了')
    expect(line.textContent).not.toContain('联网查的')
  })
})
