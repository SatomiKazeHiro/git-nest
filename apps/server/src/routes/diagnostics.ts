import type { FastifyPluginAsync } from 'fastify'
import { clearCommandLog, recentCommands } from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import { lastAutoFetch, runAutoFetch } from '../lib/auto-fetch.ts'

/**
 * 可观测性接口：**这个软件自己跑了哪些 git 命令**。
 *
 * 起因是用户要求「自动 fetch 可以，但要把执行过的命令都记下来，方便查看」。
 * 一个会自己联网的程序，如果留不下痕迹，用户没法判断它到底做了什么、
 * 是不是在偷偷动他的仓库。
 *
 * 明确边界：日志在内存里、只留最近 1000 条、重启即清空。
 * 它是**排查工具**，不是审计系统——不落库、不追加写文件。
 */
export const diagnosticsRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  /**
   * `?limit=` 只取最近的 N 条（默认 100，上限 1000，新的在后）。
   * 界面只需要看最近这些；全量返回在几百个仓库跑过一轮之后会很吵。
   */
  fastify.get('/commands', async (req) => {
    const query = (req.query ?? {}) as { limit?: string }
    const requested = Number(query.limit)
    const limit =
      Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 1000) : 100
    const all = recentCommands()
    const entries = all.slice(-limit).reverse() // 新的在前，界面直接铺开
    return { entries, total: all.length, lastAutoFetch: lastAutoFetch() }
  })

  fastify.delete('/commands', async () => {
    clearCommandLog()
    return { ok: true }
  })

  /**
   * 手动触发一轮自动 fetch。
   *
   * 存在的理由：定时器最快也要等 30 秒，测试和「我就想现在刷一下」都不方便。
   * 它跑的是**同一个** `runAutoFetch`，所以行为与定时完全一致。
   */
  fastify.post('/auto-fetch', async () => {
    return { summary: await runAutoFetch(db) }
  })
}
