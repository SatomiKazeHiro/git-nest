import { config } from '../config.ts'

/**
 * 允许的浏览器来源（CORS 白名单）。
 *
 * - `GIT_NEST_CORS`（默认是 web 端口那个来源）里的那一个，外加本机的等价
 *   写法——vite 端口用 127.0.0.1 打开时 Origin 就不是 localhost，
 *   那不是「跨站」，不该被拦
 * - 打包成桌面软件后 webview 自己的来源（见 `config.tauriOrigins`）。
 *   少了这一组，装成应用之后**每一个写接口都会 403**，而本地开发完全正常——
 *   这类只在打包后现形的故障最难查，所以写进配置而不是等到那天再补
 *
 * ## 为什么单独一个文件
 *
 * 这份清单有**两个**消费者，而第二个容易漏：
 * 1. `app.ts`：`@fastify/cors` 插件 + 跨站写入闸；
 * 2. `routes/updates.ts` 的 SSE 端点：它直接往 `reply.raw` 写头部，绕开了
 *    Fastify 的发送通道，**插件设的头一个也到不了线上**，必须自己按这份清单补。
 *
 * 抄第二份清单的后果不是报错，而是「打包后进度流永远连不上，而其它接口全好」——
 * 与 `lib/api.ts` 顶部那段「各写一份 = 悄悄漏一处」同一个教训。
 */
export function allowedOrigins(): string[] {
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
 * 一条**自己写响应头**的响应该带哪些 CORS 头（目前只有 SSE 走这条路）。
 *
 * - 来源在白名单里 → 回 `access-control-allow-origin`，浏览器才允许读；
 * - 不在白名单（或压根没带 Origin，比如 curl / 测试）→ **什么都不加**，
 *   跨源的浏览器页面就会被拦在读之外（进度里有项目名，不该漏给任意页面）。
 * - `vary` 无论如何都要有：这条响应随 Origin 变化，中间缓存不能把它复用给别的来源。
 */
export function corsHeadersFor(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' }
  if (origin !== undefined && allowedOrigins().includes(origin)) {
    headers['access-control-allow-origin'] = origin
  }
  return headers
}
