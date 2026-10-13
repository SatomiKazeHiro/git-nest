import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { api, apiBase, apiUrl } from './api'
import { useUpdateTask } from '@/features/updates/taskStream'
import { server } from '@/test/mocks/server'
import { FakeEventSource } from '@/test/setup'

/**
 * API 基地址：**打包形态下唯一挡住「装出来能用」的东西**。
 *
 * 背景（完整版见 `lib/api.ts` 顶部）：dev 下 `/api` 是相对路径、由 vite 代理转到
 * 36379；打包后没有 dev server、没有代理，相对路径会打到 webview 自己身上
 * （`http://tauri.localhost`），于是**一个请求都到不了服务端**。
 * 壳于是在页面加载前注入 `globalThis.__GIT_NEST_API_BASE__`。
 *
 * 这个文件钉两件事：**没注入时行为一字不变**（相对路径，代理照旧），
 * **注入后 fetch 与 EventSource 都真的打到注入地址**。
 */

/** 与 `lib/api.ts` 里那个常量一致；这里刻意重抄一个字面量，因为测的就是这个名字。 */
const BASE_GLOBAL = '__GIT_NEST_API_BASE__'

/** 装/卸注入值。写在函数里，免得 `__GIT_NEST_API_BASE__` 这个字面量散在用例里。 */
function installInjectedBase(value: string | undefined): void {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>)[BASE_GLOBAL]
    return
  }
  ;(globalThis as Record<string, unknown>)[BASE_GLOBAL] = value
}

beforeEach(() => installInjectedBase(undefined))
afterEach(() => installInjectedBase(undefined))

describe('apiBase() / apiUrl()：没注入时退回相对路径（浏览器开发的行为）', () => {
  it('没有注入 → 基地址是空串，拼出来仍是 /api/... 相对路径', () => {
    expect(apiBase()).toBe('')
    expect(apiUrl('/projects')).toBe('/api/projects')
    expect(apiUrl('/projects/7/logo')).toBe('/api/projects/7/logo')
  })

  it('注入值不能用了（空/相对路径/非 http/不是字符串）→ 一律退回相对路径，不产生半个地址', () => {
    // 这些值都会静默产生「谁也不认识的地址」，而表现和「服务没起来」一模一样，
    // 所以宁可退回旧行为（一定是对的）
    for (const bad of ['', '   ', '/api', 'tauri://localhost', 'undefined', 'null']) {
      installInjectedBase(bad)
      expect(apiBase(), `注入值 ${JSON.stringify(bad)} 不该被接受`).toBe('')
      expect(apiUrl('/projects')).toBe('/api/projects')
    }
    installInjectedBase(undefined)
    expect(apiBase()).toBe('')
  })

  it('path 少了前导斜杠也不会拼出 //api', () => {
    installInjectedBase('http://127.0.0.1:36379')
    expect(apiUrl('projects')).toBe('http://127.0.0.1:36379/api/projects')
  })
})

describe('apiBase() / apiUrl()：注入之后', () => {
  it('基地址就是注入值，结尾多余的斜杠会被去掉（同一个地址不该有两种写法）', () => {
    installInjectedBase('http://127.0.0.1:36379')
    expect(apiBase()).toBe('http://127.0.0.1:36379')
    expect(apiUrl('/settings')).toBe('http://127.0.0.1:36379/api/settings')

    installInjectedBase('http://127.0.0.1:41234/')
    expect(apiBase()).toBe('http://127.0.0.1:41234')
    expect(apiUrl('/settings')).toBe('http://127.0.0.1:41234/api/settings')
  })

  it('fetch 打到注入的绝对地址', async () => {
    const base = 'http://127.0.0.1:41234'
    installInjectedBase(base)
    let hit: string | null = null
    server.use(
      http.get(`${base}/api/settings`, ({ request }) => {
        hit = request.url
        return HttpResponse.json({ settings: { ok: true } })
      }),
    )

    await api.get('/settings')

    expect(hit).not.toBeNull()
    expect(hit).toBe(`${base}/api/settings`)
  })

  it('EventSource 也打到注入的绝对地址（SSE 那一路最容易漏）', async () => {
    const base = 'http://127.0.0.1:41234'
    installInjectedBase(base)
    server.use(
      http.post(`${base}/api/updates/check`, () =>
        HttpResponse.json({ id: 'task-check', items: [], state: 'running' }, { status: 202 }),
      ),
    )

    render(<StreamStarter />)

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))
    expect(FakeEventSource.instances[0]?.url).toBe(`${base}/api/updates/task-check/events`)
  })
})

/**
 * 挂载后主动发起一次「检查更新」——于是 hook 会拿 `startCheck` 的返回去建 SSE。
 *
 * 为什么用组件而不是直接调 `startCheck()`：`EventSource` 是 **hook 内部**建的
 * （`connect()` 里那句），只有把 hook 挂起来才走得到那条路。直接调 `startCheck()`
 * 只覆盖到 POST，覆盖不到 SSE——而 SSE 恰恰是最容易漏掉的那个调用点。
 */
function StreamStarter() {
  const task = useUpdateTask()
  useEffect(() => {
    void task.startCheck([])
  }, [])
  return null
}

describe('startCheck：POST 也走同一个收口', () => {
  it('注入后 POST 打到注入地址', async () => {
    const base = 'http://127.0.0.1:41234'
    installInjectedBase(base)
    let hit: string | null = null
    server.use(
      http.post(`${base}/api/updates/check`, ({ request }) => {
        hit = request.url
        return HttpResponse.json({ id: 'task-x', items: [], state: 'running' }, { status: 202 })
      }),
    )

    render(<StreamStarter />)

    await waitFor(() => expect(hit).toBe(`${base}/api/updates/check`))
  })
})
