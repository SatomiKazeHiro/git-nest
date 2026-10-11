import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { builtinCategoryList } from '@git-nest/core'

/** 清单页与更新面板用到的接口 */
export const handlers = [
  http.get('/api/settings', () =>
    HttpResponse.json({
      settings: {
        includeOwn: false,
        gitTimeoutMs: 120_000,
        concurrency: 4,
        confirmThreshold: 20,
        scanDirs: [],
      },
    }),
  ),
  /*
    分类：默认就返回内置四个。

    必须有一条兜底：左栏 / 添加项目的表单 / 详情页 / 设置**都会读它**，而这里
    `server.listen({ onUnhandledFrame: 'error' })`（见 `test/setup.ts`）——没 mock 的
    请求会让用例直接失败。少了这条，上面那四处每加一个用例都得自己补一遍。
  */
  http.get('/api/categories', () => HttpResponse.json({ categories: builtinCategoryList() })),
]

export const server = setupServer(...handlers)
