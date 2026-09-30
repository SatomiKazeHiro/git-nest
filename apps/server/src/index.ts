import { buildApp } from './app.ts'
import { config } from './config.ts'

const { app, db } = buildApp()

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`数据库：${config.dbFile}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    void app.close().then(() => {
      db.close()
      process.exit(0)
    })
  })
}
