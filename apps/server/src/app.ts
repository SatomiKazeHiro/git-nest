import cors from '@fastify/cors'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import type { Scheduler } from '@git-nest/core/git'
import { config } from './config.ts'
import { openDatabase, type DB } from './db/index.ts'
import { HttpError, toErrorBody } from './lib/errors.ts'
import { bindSettings, useScheduler } from './lib/git.ts'
import { categoryRoutes, projectRoutes, tagRoutes } from './routes/index.ts'
import { gitRoutes } from './routes/git.ts'
import { logoRoutes } from './routes/logo.ts'
import { updateRoutes } from './routes/updates.ts'
import { settingsRoutes } from './routes/settings.ts'
import { scanRoutes } from './routes/scan.ts'
import { diagnosticsRoutes } from './routes/diagnostics.ts'

 interface AppOptions {
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
  // forceCloseConnections：SSE 是永不主动结束的「活跃请求」，默认设置下
  // `app.close()` 会一直等它结束（实测等了 9 秒 = 任务自己跑完的时间），
  // Ctrl-C 之后进程退不掉。关服务时直接断开连接。
  const app = Fastify({ logger: options.logger ?? true, forceCloseConnections: true })

  app.register(cors, { origin: allowedOrigins() })

  /*
    **跨站写入闸**：本机工具没有鉴权，而「没有鉴权」不等于「浏览器里的任意页面都能
    指挥它」。攻击面很具体：恶意页面用 `<form>`/`fetch` 发一个**简单请求**
    （无 content-type、无 body —— Fastify 照收，实测 200）就能触发
    `POST /api/updates/check`（全部仓库联网 fetch）、`POST /api/auto-fetch`；
    DNS rebinding 下更能直接读响应。CORS 挡不住这个：它只决定「能不能读响应」，
    **副作用早就发生了**。

    只拦「带 Origin 且不在白名单」的写请求：
    - 浏览器跨站一定会带 Origin（表单、fetch、XHR 都是），所以这一条就够挡住上面那些；
    - curl / 脚本 / 测试不带 Origin —— 不拦（本机工具的正常用法要留着）；
    - 同源的页面（vite 代理下就是 web 端口那个来源）带的是白名单里的 Origin。

    只做**一层**校验，不做「本机才允许」那类判断：Host 在 vite 代理（changeOrigin:false）
    下仍是 localhost 加 web 端口，按 Host 卡会误伤正常开发。
  */
  app.addHook('onRequest', async (req, reply) => {
    if (!WRITE_METHODS.has(req.method)) return
    const origin = req.headers.origin
    if (origin === undefined) return
    if (allowedOrigins().includes(origin)) return
    await reply.code(403).send({
      code: 'cross_origin_blocked',
      message: `拒绝跨站写入（Origin: ${origin}）。这是本机工具，写操作只允许来自 ${allowedOrigins().join(' / ')}`,
    })
  })

  // 健康检查：真的探一下数据库（`SELECT 1`），而不是恒真。
  // 不回数据库绝对路径 —— 本机路径只进本地 SQLite，不该顺着 HTTP 出去。
  app.get('/api/health', async () => {
    try {
      db.prepare('SELECT 1').get()
      return { ok: true, database: 'ok' }
    } catch {
      return { ok: false, database: 'unreadable' }
    }
  })

  app.register(projectRoutes(db), { prefix: '/api' })
  app.register(tagRoutes(db), { prefix: '/api' })
  app.register(categoryRoutes(db), { prefix: '/api' })
  app.register(gitRoutes(db), { prefix: '/api' })
  app.register(logoRoutes(db), { prefix: '/api' })
  app.register(updateRoutes(db), { prefix: '/api' })
  app.register(settingsRoutes(db), { prefix: '/api' })
  app.register(scanRoutes(db), { prefix: '/api' })
  app.register(diagnosticsRoutes(db), { prefix: '/api' })

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
 * 会被跨站简单请求打到的写方法。
 * GET/HEAD/OPTIONS 不在里头：它们本来就该可跨站读（而且没有副作用）。
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 允许的浏览器来源：
 * - `GIT_NEST_CORS`（默认是 web 端口那个来源）里的那一个，外加本机的等价
 *   写法——vite 端口用 127.0.0.1 打开时 Origin 就不是 localhost，
 *   那不是「跨站」，不该被拦
 * - 打包成桌面软件后 webview 自己的来源（见 `config.tauriOrigins`）。
 *   少了这一组，装成应用之后**每一个写接口都会 403**，而本地开发完全正常——
 *   这类只在打包后现形的故障最难查，所以写进配置而不是等到那天再补
 */
function allowedOrigins(): string[] {
  const base = config.corsOrigin
  const out = new Set([base, ...config.tauriOrigins])
  try {
    const url = new URL(base)
    const mirror = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
    out.add(`${url.protocol}//${mirror}${url.port ? `:${url.port}` : ''}`)
  } catch {
    // 配了个不是 URL 的东西：那就只认字面量
  }
  return [...out]
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
