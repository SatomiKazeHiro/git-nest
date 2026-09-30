import cors from '@fastify/cors'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { config } from './config.ts'
import { openDatabase, type DB } from './db/index.ts'
import { HttpError, toErrorBody } from './lib/errors.ts'
import { noteRoutes, projectRoutes, tagRoutes } from './routes/index.ts'
import { gitRoutes } from './routes/git.ts'

export interface AppOptions {
  db?: DB
  logger?: boolean
}

export function buildApp(options: AppOptions = {}) {
  const db = options.db ?? openDatabase()
  const app = Fastify({ logger: options.logger ?? true })

  app.register(cors, { origin: config.corsOrigin })

  app.get('/api/health', async () => ({ ok: true, db: config.dbFile }))

  app.register(projectRoutes(db), { prefix: '/api' })
  app.register(noteRoutes(db), { prefix: '/api' })
  app.register(tagRoutes(db), { prefix: '/api' })
  app.register(gitRoutes(db), { prefix: '/api' })

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
