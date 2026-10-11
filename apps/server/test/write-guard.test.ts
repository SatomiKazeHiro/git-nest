import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase } from '../src/db/index.ts'

/**
 * 跨站写入闸。
 *
 * 本机工具没有鉴权，而「没有鉴权」≠「浏览器里任意页面都能指挥它」。攻击面很具体：
 * 恶意页面发一个**简单请求**（无 content-type、无 body —— Fastify 照收，实测 200）
 * 就能触发 `POST /api/updates/check`（全部仓库联网 fetch）或 `POST /api/auto-fetch`；
 * CORS 挡不住，因为它只决定「能不能读响应」，副作用早就发生了。
 *
 * 判据只做一层：写方法 + **带了 Origin** + 不在白名单 → 403。
 * 不带 Origin（curl / 脚本 / 测试）不拦——那是本机工具的正常用法。
 */

const app = buildApp({ db: openDatabase(':memory:'), logger: false }).app

describe('写接口的跨站闸', () => {
  it('带外站 Origin 的 POST 直接 403（副作用不能发生）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auto-fetch',
      headers: { origin: 'http://evil.example' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('cross_origin_blocked')
  })

  it('白名单里的 Origin（本机 web）照常放行', async () => {
    // 只验闸门本身：这一条会真的去跑一轮 auto-fetch，但库里没有项目，等于空跑
    const res = await app.inject({
      method: 'POST',
      url: '/api/auto-fetch',
      headers: { origin: 'http://localhost:36378' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('127.0.0.1 写法也算同源（vite 用 127.0.0.1 打开时 Origin 不是 localhost）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auto-fetch',
      headers: { origin: 'http://127.0.0.1:36378' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('不带 Origin 的请求不拦（curl / 脚本 / 测试）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auto-fetch' })
    expect(res.statusCode).toBe(200)
  })

  /*
    打包成桌面软件之后的来源。

    这几条是「等打包那天才发现就晚了」的那一类：开发时页面跑在 vite 上，
    Origin 是 http://localhost:36378，一路绿灯；装成应用之后 webview 换了自己的
    来源，于是添加项目、勾选更新、设置**全部 403**——而本地开发毫无异常。
    把它们写进白名单与测试，是为了在打包之前就把这件事解决掉。
  */
  it.each([
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
  ])('打包成桌面软件后的来源 %s 照常放行写操作', async (origin) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auto-fetch',
      headers: { origin },
    })
    expect(res.statusCode).toBe(200)
  })

  it('读接口不受影响（GET 没有副作用）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { origin: 'http://evil.example' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('外站 Origin 的 DELETE 同样拦住', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/commands',
      headers: { origin: 'http://evil.example' },
    })
    expect(res.statusCode).toBe(403)
  })
})
