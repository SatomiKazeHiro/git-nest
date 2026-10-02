import { buildApp } from './app.ts'
import { config } from './config.ts'
import { startAutoFetch, stopAutoFetch } from './lib/auto-fetch.ts'

const { app, db } = buildApp()

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`数据库：${config.dbFile}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// 自动 fetch：让远程状态保持新鲜（只动 refs/remotes/*，绝不碰工作区）。
// 首次延迟 30 秒、之后每 30 分钟一轮；每一条命令都进命令日志（GET /api/commands）。
// 只写在真正的入口里，不在 buildApp 里启动——测试注入 app 时不该有后台联网。
startAutoFetch(db)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    stopAutoFetch()
    void app.close().then(() => {
      db.close()
      process.exit(0)
    })
  })
}
