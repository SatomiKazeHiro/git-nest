import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { UpdatePanel } from './UpdatePanel'
import { server } from '@/test/mocks/server'
import { FakeEventSource } from '@/test/setup'

/**
 * 设计文档第 9 节要求的 happy path：
 * 检查更新 → 看到每个仓库的报告 → 勾选能更新的 → 更新 → 看到结果汇总。
 *
 * 进度靠 SSE 推，这里用可控的假 EventSource 驱动（见 test/setup.ts），
 * 比真 SSE 好测：事件顺序由测试决定，不会有时序抖动。
 */

function renderPanel(ids: number[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      {/* 面板里有指向项目详情的 Link，需要路由上下文 */}
      <MemoryRouter>
        <UpdatePanel ids={ids} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const lastCheckTask = {
  id: 'task-check',
  kind: 'check' as const,
  status: 'running' as const,
  total: 3,
  done: 0,
  items: [
    { projectId: 1, name: 'behind-one', state: 'pending' as const },
    { projectId: 2, name: 'up-to-date', state: 'pending' as const },
    { projectId: 3, name: 'diverged', state: 'pending' as const },
  ],
}

const applyTask = {
  id: 'task-apply',
  kind: 'apply' as const,
  status: 'running' as const,
  total: 1,
  done: 0,
  items: [{ projectId: 1, name: 'behind-one', state: 'pending' as const }],
}

function report(status: string, behind: number, subject = '远程提交') {
  return {
    status,
    ahead: 0,
    behind,
    incoming:
      behind > 0
        ? [{ shortHash: 'abc1234', subject, author: 't', date: '' }]
        : [],
    outgoing: [],
    tags: [],
    error: null,
  }
}

function useButton(name: RegExp | string) {
  return screen.getByRole('button', { name })
}

async function click(name: RegExp | string) {
  const el = useButton(name) as HTMLButtonElement
  expect(el.disabled, `按钮「${name}」应该是可点的`).toBe(false)
  fireEvent.click(el)
}

/** 等假 EventSource 建好（React Query 建连接是异步的） */
async function waitForStream() {
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))
  return FakeEventSource.instances[FakeEventSource.instances.length - 1]!
}

describe('勾选更新流程', () => {
  it('检查 → 看报告 → 只勾能快进的 → 更新 → 汇总', async () => {
    const applied: number[][] = []

    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
      http.post('/api/updates/apply', async ({ request }) => {
        applied.push(((await request.json()) as { ids: number[] }).ids)
        return HttpResponse.json(applyTask, { status: 202 })
      }),
    )

    renderPanel([1, 2, 3])

    // 1. 点「检查更新」→ 拿到 task → 订阅进度
    await click(/检查更新/)
    const checkStream = await waitForStream()
    expect(checkStream.url).toContain('/api/updates/task-check/events')

    // 2. 逐个仓库的报告推过来
    checkStream.emit({
      type: 'item',
      done: 1,
      item: { projectId: 1, name: 'behind-one', state: 'done', result: report('behind', 2) },
    })
    checkStream.emit({
      type: 'item',
      done: 2,
      item: { projectId: 2, name: 'up-to-date', state: 'done', result: report('up_to_date', 0) },
    })
    checkStream.emit({
      type: 'item',
      done: 3,
      item: {
        projectId: 3,
        name: 'diverged',
        state: 'done',
        result: report('diverged', 1, '分叉那边的提交'),
      },
    })

    // 报告里的关键信息真的渲染出来了
    await waitFor(() => expect(screen.getByText('落后远程')).toBeTruthy())
    expect(screen.getByText('已是最新')).toBeTruthy()
    expect(screen.getByText('已分叉')).toBeTruthy()
    expect(screen.getByText('远程提交')).toBeTruthy() // 待拉取的提交标题
    expect(screen.getByText('分叉那边的提交')).toBeTruthy()

    // 检查任务收尾，底部才出现「更新选中的」按钮
    checkStream.emit({
      type: 'finished',
      total: 3,
      summary: { behind: 1, upToDate: 1, ahead: 0, diverged: 1, skipped: 0, failed: 0 },
    })
    checkStream.emit({ type: 'closed' })
    await waitFor(() => expect(screen.getByText(/检查完：/)).toBeTruthy())

    // 分叉的仓库不能勾（勾了也没用），behind 的可以
    const divergedBox = screen.getByLabelText('选择 diverged') as HTMLInputElement
    const behindBox = screen.getByLabelText('选择 behind-one') as HTMLInputElement
    expect(divergedBox.disabled).toBe(true)
    expect(behindBox.disabled).toBe(false)

    // 3. 勾上，底部按钮的计数跟着变
    const applyBtn = useButton(/更新选中的/) as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true) // 还没勾
    fireEvent.click(behindBox)
    await waitFor(() =>
      expect((useButton(/更新选中的/) as HTMLButtonElement).textContent).toContain('1'),
    )    // 4. 更新
    await click(/更新选中的/)
    const applyStream = await waitForStream()
    expect(applyStream.url).toContain('/api/updates/task-apply/events')
    expect(applied).toEqual([[1]]) // 只有勾的那个，不是全部

    // 5. 结果汇总
    applyStream.emit({
      type: 'item',
      done: 1,
      item: {
        projectId: 1,
        name: 'behind-one',
        state: 'done',
        result: {
          outcome: 'updated',
          newCommits: 2,
          status: 'up_to_date',
          reason: null,
          error: null,
          summary: '已更新 2 个提交',
        },
      },
    })
    applyStream.emit({
      type: 'finished',
      total: 1,
      summary: { updated: 1, upToDate: 0, skipped: 0, failed: 0, commits: 2 },
    })
    applyStream.emit({ type: 'closed' })

    await waitFor(() =>
      expect(screen.getByText(/已更新 1 个仓库，共 2 个提交/)).toBeTruthy(),
    )
  })

  it('超过确认阈值时先问一遍，不直接开跑', async () => {
    let checks = 0
    let settingsCalls = 0
    server.use(
      http.get('/api/settings', () => {
        settingsCalls += 1
        return HttpResponse.json({
          settings: {
            includePersonal: false,
            gitTimeoutMs: 120_000,
            concurrency: 4,
            confirmThreshold: 2, // 故意调小
            scanDirs: [],
          },
        })
      }),
      http.post('/api/updates/check', () => {
        checks += 1
        return HttpResponse.json(lastCheckTask, { status: 202 })
      }),
    )

    renderPanel([1, 2, 3])
    // 等设置真的到了再点：阈值是从设置里读的
    await waitFor(() => expect(settingsCalls).toBe(1))
    await waitFor(() => expect(screen.getByText(/将检查当前筛选出的 3 个项目/)).toBeTruthy())

    // 第一次点：只弹确认，还没发请求
    await click(/检查更新/)
    await waitFor(() => expect(screen.getByText(/要对 3 个项目联网 fetch/)).toBeTruthy())
    expect(checks).toBe(0)

    // 「再想想」可以撤销
    await click(/再想想/)
    await waitFor(() => expect(screen.queryByText(/要对 3 个项目联网 fetch/)).toBeNull())

    // 再点一次仍然是确认，确认之后才真的发
    await click(/检查更新/)
    await click(/确认，检查这 3 个/)
    await waitFor(() => expect(checks).toBe(1))
  })

  it('启动失败时把后端的原话显示出来', async () => {
    server.use(
      http.post('/api/updates/check', () =>
        HttpResponse.json(
          { code: 'bad_request', message: '选中的项目都属于 personal，没法自动检查（3 个）' },
          { status: 400 },
        ),
      ),
    )

    renderPanel([1, 2, 3])
    await click(/检查更新/)

    await waitFor(() =>
      expect(screen.getByText(/都属于 personal/)).toBeTruthy(),
    )
  })
})
