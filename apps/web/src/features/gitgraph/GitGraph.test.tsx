import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GitGraph } from './GitGraph'
import { server } from '@/test/mocks/server'

/**
 * 提交图现在是 `@tomplum/react-git-log` 的薄封装（见 GitGraph.tsx 的注释：
 * 自研那版有车道泄漏，真实仓库里 75/120 个提交点被画到画布外）。
 *
 * 这个测试守两件事：
 * 1. 服务器字段到库字段的映射对得上（`message`/`author`/`committerDate`/`branch`）。
 *    库要的字段名和我们 core 的 `GitLogEntry` 不一样，映射写错就整张图空掉。
 * 2. 真的把条目渲染出来（不是白屏）。
 */

const BRANCH = 'main'

function makeEntries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    hash: `${'a'.repeat(6)}${i}ff`,
    shortHash: `a${i}ff`,
    parents: i === n - 1 ? [] : [`${'a'.repeat(6)}${i + 1}ff`],
    authorName: 'git-nest test',
    authorEmail: 'dev@git-nest.test',
    date: '2026-10-01T12:00:00+08:00',
    committerDate: '2026-10-01T12:00:00+08:00',
    authorDate: '2026-10-01T11:00:00+08:00',
    branch: BRANCH,
    subject: `提交 ${i}`,
    refs: i === 0 ? ['HEAD -> main'] : [],
  }))
}

function renderGraph(projectId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <GitGraph projectId={projectId} />
    </QueryClientProvider>,
  )
}

describe('提交图（react-git-log）', () => {
  it('把提交条目渲染出来', async () => {
    server.use(
      http.get('/api/projects/1/log', () =>
        HttpResponse.json({ entries: makeEntries(4), branch: BRANCH }),
      ),
    )

    renderGraph()

    await waitFor(() => expect(screen.getByText('提交 0')).toBeTruthy())
    expect(screen.getByText('提交 3')).toBeTruthy()
    // 作者与分支信息也要在
    expect(screen.getAllByText('git-nest test').length).toBeGreaterThan(0)
    expect(screen.getAllByText(BRANCH).length).toBeGreaterThan(0)
  })

  it('空历史显示「还没有提交」而不是空白', async () => {
    server.use(
      http.get('/api/projects/2/log', () => HttpResponse.json({ entries: [], branch: BRANCH })),
    )
    renderGraph(2)
    await waitFor(() => expect(screen.getByText('这个仓库还没有提交。')).toBeTruthy())
  })

  it('读不到时显示后端给的说明', async () => {
    server.use(
      http.get('/api/projects/3/log', () =>
        HttpResponse.json(
          { code: 'bad_request', message: '目录不在了，读不到提交记录' },
          { status: 400 },
        ),
      ),
    )
    renderGraph(3)
    await waitFor(() =>
      expect(screen.getByText('目录不在了，读不到提交记录')).toBeTruthy(),
    )
  })
})
