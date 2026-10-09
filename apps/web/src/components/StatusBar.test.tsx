import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '@/test/mocks/server'
import { StatusBar } from './StatusBar'

/**
 * 状态栏右端的「上次检查」。
 *
 * 钉的是**没查过时那一支**：清单里一个项目都没点过「联网检查更新」是很正常的
 * 状态（刚装上、刚导入），那句话必须说清楚「还没检查过」。写成占位符「—」的话，
 * 用户读到的是一个残缺的时间栏，不知道是没查还是读不出来。
 */

const project = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'demo',
  path: 'D:/repos/demo',
  remoteUrl: null,
  isOwn: false,
  category: '',
  record: '',
  addedAt: '2026-10-01T00:00:00Z',
  sortOrder: 1,
  tags: [],
  latestCheck: null,
  attention: 'unchecked',
  ...over,
})

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<StatusBar />, { wrapper: Wrapper })
}

beforeEach(() => {
  server.use(http.get('/api/projects', () => HttpResponse.json({ projects: [], total: 0 })))
})

describe('状态栏的「上次检查」', () => {
  it('一个都没查过：说「还没检查过」', async () => {
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json({ projects: [project(), project({ id: 2 })], total: 2 }),
      ),
    )
    renderBar()
    await waitFor(() => expect(screen.getByText(/还没检查过/)).toBeTruthy())
  })

  it('清单是空的也不报错，只说「还没检查过」', async () => {
    renderBar()
    await waitFor(() => expect(screen.getByText(/还没检查过/)).toBeTruthy())
  })

  it('取全清单里最近的那次，不是第一个项目的', async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json({
          projects: [
            project({
              id: 1,
              latestCheck: {
                checkedAt: '2026-10-05T00:00:00.000Z',
                status: 'behind',
                aheadCount: 0,
                behindCount: 1,
                recommendation: null,
              },
            }),
            project({
              id: 2,
              latestCheck: {
                checkedAt: recent,
                status: 'behind',
                aheadCount: 0,
                behindCount: 3,
                recommendation: null,
              },
            }),
          ],
          total: 2,
        }),
      ),
    )
    renderBar()
    await waitFor(() => expect(screen.getByText(/5 分钟前/)).toBeTruthy())
  })
})