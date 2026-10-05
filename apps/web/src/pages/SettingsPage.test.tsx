import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { server } from '@/test/mocks/server'
import { SettingsPage } from '@/pages/SettingsPage'

/**
 * 设置页那三个数字输入框。
 *
 * 原来的写法是「每次按键就 PATCH + 显示值来自服务端回值」：想从 120000 改成 60000，
 * 清空后敲下的第一个字符是 `6`，越界 → 服务端 422 → mutation 状态一变就重渲染
 * → 受控值被写回 120000 ——**用户敲的字符被吞掉**，那个字段根本没法正常改。
 * 现在输入期间只动本地草稿，回车 / 失焦才提交。
 */

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 0 } },
  })
}

const settings = {
  includePersonal: false,
  gitTimeoutMs: 120_000,
  concurrency: 4,
  confirmThreshold: 20,
  scanDirs: [],
}

let patches: Record<string, unknown>[]

beforeEach(() => {
  patches = []
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

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('设置里的数字字段', () => {
  it('输入期间不发请求，敲进去的字符不会被服务端回值弹回去', async () => {
    renderPage()
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
    renderPage()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '60000' } })
    fireEvent.blur(input)

    await waitFor(() => expect(patches).toEqual([{ gitTimeoutMs: 60_000 }]))
    await waitFor(() => expect(input.value).toBe('60000'))
  })

  it('越界在前端就拦下并说明，不发请求', async () => {
    renderPage()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.blur(input)

    await waitFor(() => expect(screen.getByText(/要在 1000 – 600000 之间/)).toBeTruthy())
    expect(patches).toHaveLength(0)
    expect(input.value).toBe('10')
  })

  it('清空后不改动，只把显示退回原值', async () => {
    renderPage()
    const input = (await screen.findByLabelText('git 超时')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    await waitFor(() => expect(input.value).toBe('120000'))
    expect(patches).toHaveLength(0)
  })
})
