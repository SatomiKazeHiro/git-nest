import { buildApp } from './app.ts'
import { config } from './config.ts'
import { startAutoFetch, stopAutoFetch } from './lib/auto-fetch.ts'

const { app, db } = buildApp()

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`数据库：${config.dbFile}`)
  /*
    绑到非回环地址 = 局域网里任何人都能改你的清单、触发 pull、扫你的目录
    （全部接口都没有鉴权，这是本机单用户工具的设计前提）。
    不拦——那是用户自己的选择——但必须把那句话说出来。
  */
  if (!isLoopbackHost(config.host)) {
    app.log.warn(
      `监听地址是 ${config.host}（不是回环）：同一网络里的**任何人**都能访问这些接口——` +
        '改清单、触发联网 fetch / pull、扫描目录，全部没有鉴权。确认这是你要的。',
    )
  }
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

/** 回环地址：IPv4 / IPv6 / localhost。 */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.')
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
