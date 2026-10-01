import cors from '@fastify/cors'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import type { Scheduler } from '@git-nest/core/git'
import { config } from './config.ts'
import { openDatabase, type DB } from './db/index.ts'
import { HttpError, toErrorBody } from './lib/errors.ts'
import { bindSettings, useScheduler } from './lib/git.ts'
import { noteRoutes, projectRoutes, tagRoutes } from './routes/index.ts'
import { gitRoutes } from './routes/git.ts'
import { updateRoutes } from './routes/updates.ts'
import { settingsRoutes } from './routes/settings.ts'
import { scanRoutes } from './routes/scan.ts'

export interface AppOptions {
  db?: DB
  logger?: boolean
  /** 换掉 `lib/git.ts` 里那个全局 scheduler（测试注入用） */
  scheduler?: Scheduler
}

export function buildApp(options: AppOptions = {}) {
  const db = options.db ?? openDatabase()
  bindSettings(db)
  // 必须在 bindSettings 之后：注入的实例要接上设置里的并发上限
  if (options.scheduler) useScheduler(options.scheduler)
  const app = Fastify({ logger: options.logger ?? true })

  app.register(cors, { origin: config.corsOrigin })

  app.get('/api/health', async () => ({ ok: true, db: config.dbFile }))

  app.register(projectRoutes(db), { prefix: '/api' })
  app.register(noteRoutes(db), { prefix: '/api' })
  app.register(tagRoutes(db), { prefix: '/api' })
  app.register(gitRoutes(db), { prefix: '/api' })
  app.register(updateRoutes(db), { prefix: '/api' })
  app.register(settingsRoutes(db), { prefix: '/api' })
  app.register(scanRoutes(db), { prefix: '/api' })

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ code: 'not_found', message: `没有这个接口：${req.method} ${req.url}` }),
  )

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send(toErrorBody(err))
    }
    if (err instanceof ZodError) {
      return reply.code(422).send({
        code: 'validation_failed',
        message: '参数有误',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    // 数据库唯一约束：并发下「先查再插」之间总有窗口，所以这种事一定会发生。
    // 它是**冲突**（409），不是服务器故障（500）—— 把约束交给库层兜底，
    // 应用层只负责把错误翻译对。
    if (isUniqueConstraintError(err)) {
      return reply.code(409).send({ code: 'conflict', message: '这条记录已经存在了' })
    }
    const candidate = err as { statusCode?: unknown; message?: unknown }
    if (typeof candidate.statusCode === 'number' && candidate.statusCode < 500) {
      return reply
        .code(candidate.statusCode)
        .send({ code: 'request_error', message: String(candidate.message ?? '请求有误') })
    }
    app.log.error(err)
    return reply.code(500).send({ code: 'internal_error', message: '服务器出错了，看日志' })
  })

  return { app, db }
}

/**
 * better-sqlite3 的 UNIQUE 约束错误。
 *
 * 它的 `code` 是 `SQLITE_CONSTRAINT_UNIQUE`，`message` 形如
 * `UNIQUE constraint failed: projects.path`（或索引名）。两个都认一下，
 * 免得驱动换文案时静默退化成 500。
 */
function isUniqueConstraintError(err: unknown): boolean {
  const candidate = err as { code?: unknown; message?: unknown }
  if (candidate.code === 'SQLITE_CONSTRAINT_UNIQUE') return true
  return (
    typeof candidate.message === 'string' && /UNIQUE constraint failed/i.test(candidate.message)
  )
}
