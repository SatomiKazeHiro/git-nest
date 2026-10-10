import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { server } from '@/test/mocks/server'
import { useUiStore } from '@/store/ui'
import { SettingsDialog } from './SettingsDialog'

/**
 * 设置原来是一整页（`/settings`），现在是一个弹窗——这些用例跟着搬过来，
 * 断言一字未改：它们钉的是**数字字段的提交时机**与**「上一轮的结果」摘要**，
 * 与容器是页还是弹窗无关。
 *
 * 数字字段那条的由来：原来是「每次按键就 PATCH + 显示值来自服务端回值」——
 * 想从 120000 改成 60000，清空后敲下的第一个字符是 `6`，越界 → 服务端 422
 * → mutation 状态一变就重渲染 → 受控值被写回 120000 ——**用户敲的字符被吞掉**。
 * 现在输入期间只动本地草稿，回车 / 失焦才提交。
 */

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 0 } },
  })
}

const settings = {
  includeOwn: false,
  gitTimeoutMs: 120_000,
  concurrency: 4,
  confirmThreshold: 20,
  scanDirs: [],
}

let patches: Record<string, unknown>[]

beforeEach(() => {
  patches = []
  // 弹窗默认是关着的（`SettingsDialog` 关着时返回 null），这里把它打开
  useUiStore.setState({ settingsOpen: true })
  server.use(
    http.get('/api/settings', () => HttpResponse.json({ settings })),
    http.patch('/api/settings', async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>
      patches.push(patch)
      const timeout = patch['gitTimeoutMs']
      if (typeof timeout === 'number' && (timeout < 1000 || timeout > 600_000)) {
        return HttpResponse.json({ code: 'validation_failed', message: '参数有误' }, { status: 422 })
      }
      return HttpResponse.json({ settings: { ...settings, ...patch } })
    }),
    http.get('/api/commands', () => HttpResponse.json({ entries: [], total: 0, lastAutoFetch: null })),
    http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
  )
})

function renderDialog() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <SettingsDialog />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('设置里的数字字段', () => {
  it('输入期间不发请求，敲进去的字符不会被服务端回值弹回去', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement
    expect(input.value).toBe('120000')

    // 清空 + 开始输入（连续两次 change，和真人打字一样）
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.change(input, { target: { value: '60000' } })

    await new Promise((r) => setTimeout(r, 50))
    expect(input.value, '草稿不该被服务端旧值覆盖').toBe('60000')
    expect(patches, '没提交之前不该有请求').toHaveLength(0)
  })

  it('失焦时提交一次，并回读服务端的值', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '60000' } })
    fireEvent.blur(input)

    await waitFor(() => expect(patches).toEqual([{ gitTimeoutMs: 60_000 }]))
    await waitFor(() => expect(input.value).toBe('60000'))
  })

  it('越界在前端就拦下并说明，不发请求', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.blur(input)

    await waitFor(() => expect(screen.getByText(/要在 1000 – 600000 之间/)).toBeTruthy())
    expect(patches).toHaveLength(0)
    expect(input.value).toBe('10')
  })

  it('清空后不改动，只把显示退回原值', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    await waitFor(() => expect(input.value).toBe('120000'))
    expect(patches).toHaveLength(0)
  })
})

/**
 * 「上一轮跑了哪些仓库」这条摘要。
 *
 * 原来那条命令日志查询是 `enabled: open`——理由是「这是个排查视图，别在后台
 * 一直请求」。可摘要与日志列表是**同一份响应里的两个字段**，共用一个开关的
 * 结果是：摘要也被关在了外面，它在结构上永远显示「还没跑过」，除非用户先
 * 点开命令日志去看。
 *
 * 这条钉住的是「打开设置就取一次」。真正该省的是每 5 秒一次的轮询，那条仍然
 * 只在展开日志时才开——见 CommandsSection 里的 `refetchInterval`。
 */
describe('上一轮的结果', () => {
  it('不进命令日志面板也能读到数字', async () => {
    let asked = 0
    server.use(
      http.get('/api/commands', () => {
        asked += 1
        return HttpResponse.json({
          entries: [],
          total: 0,
          lastAutoFetch: {
            at: new Date().toISOString(),
            projects: 2,
            checked: 3,
            skipped: 1,
            failed: 0,
          },
        })
      }),
    )

    renderDialog()

    await waitFor(() => expect(asked).toBeGreaterThan(0))
    // 三个计数各自带标签，不再是用斜杠串起来的一句话
    expect(screen.getByText('有结论')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('跳过')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    // 日志面板仍是关着的
    expect(screen.queryByText('还没有命令记录')).toBeNull()
  })

  it('失败数大于 0 时那个数字才用告警色（0 个失败不该被涂红）', async () => {
    server.use(
      http.get('/api/commands', () =>
        HttpResponse.json({
          entries: [],
          total: 0,
          lastAutoFetch: {
            at: new Date().toISOString(),
            projects: 2,
            checked: 3,
            skipped: 0,
            failed: 2,
          },
        }),
      ),
    )

    renderDialog()

    await waitFor(() => expect(screen.getByText('失败')).toBeTruthy())
    const bad = screen.getByText('2')
    expect(bad.className).toContain('text-signal-bad')
  })
})
