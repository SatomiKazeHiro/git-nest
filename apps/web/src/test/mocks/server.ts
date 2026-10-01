import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/** 清单页与更新面板用到的接口 */
export const handlers = [
  http.get('/api/settings', () =>
    HttpResponse.json({
      settings: {
        includePersonal: false,
        gitTimeoutMs: 120_000,
        concurrency: 4,
        confirmThreshold: 20,
        scanDirs: [],
      },
    }),
  ),
]

export const server = setupServer(...handlers)
