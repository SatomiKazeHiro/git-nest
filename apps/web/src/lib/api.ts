import type { ApiErrorBody } from '@git-nest/core'

/*
  ============================================================================
  API 基地址：**这是全应用唯一的收口**，所有 `/api` 拼接都必须走 `apiUrl()`。
  ============================================================================

  ## 为什么需要它

  浏览器里开发时，界面与 API 的关系由 vite 代理维持：页面自己发 `/api/…`（同源，
  **相对路径**），vite 把它转到 `http://127.0.0.1:36379`。代理是 dev server 的功能。

  打包成桌面应用之后**没有 dev server、也就没有代理**：页面的来源变成 Tauri 的
  自定义协议（Windows 上是 `http://tauri.localhost`），于是相对路径 `/api/…`
  会打到 **webview 自己身上**，一个请求都到不了服务端。表现是
  「dev 下一路正常，装出来整个界面是空的」——最难查的那一类。

  所以打包形态下地址必须由壳给：壳在**页面加载前**注入
  `globalThis.__GIT_NEST_API_BASE__`（见 `src-tauri/src/lib.rs` 里
  `WebviewWindowBuilder::initialization_script` 的用法），这里把它读出来。

  ## 为什么是「壳注入」而不是构建期钉死

  端口可被 `GIT_NEST_PORT` 覆盖（见 README）。构建期用 Vite `define` 把 `36379`
  写死，会制造一个很难查的组合故障：用户改了端口 → 服务端监听新端口、前端还在
  打旧端口 → 报「连不上后端」，而那条报错**不会告诉你是端口没跟上**。
  这与 `src-tauri/tauri.conf.json` 里 CSP 的 `connect-src` **只写 host、不写端口**
  是同一个道理：地址是运行期事实，就不该在构建期定稿。

  ## 拿不到就退回相对路径

  空串是**正常状态**，不是错误：浏览器里开发、以及所有现有测试都没有这个全局量，
  此时行为必须与从前**一模一样**（`/api/…`，走 vite 代理）。
*/

/** 壳注入的全局变量名。与 `src-tauri/src/lib.rs` 里那串字符串必须一致。 */
const BASE_GLOBAL = '__GIT_NEST_API_BASE__'

/**
 * 把注入值规范化成可用的基地址；不可用就返回空串（= 用相对路径）。
 *
 * 为什么要校验而不是拿起来就用：这是**跨进程传进来的字符串**，写错了（少个协议头、
 * 值是 `undefined` 的字面量、根本不是字符串）会静默产生一个谁也不认识的地址，
 * 而表现和「服务没起来」一模一样——又是一个要查很久的故障。
 * 这里只做两件事：认不出就退回相对路径（旧行为一定是对的），
 * 认得出就把结尾的斜杠去掉（好拼）。
 */
function normalizeBase(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (value === '') return ''
  try {
    // 只有完整 URL 才算数；相对路径在这里会抛，正好落回空串
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return value.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/**
 * API 基地址（**不含**结尾斜杠）。空串 = 用相对路径走 vite 代理。
 *
 * 刻意是**函数**而不是模块级常量：模块级常量会把第一次读到的值固化下来，
 * 于是「注入之后」那条用例永远测不到（同一个模块实例换不掉）。
 */
export function apiBase(): string {
  return normalizeBase((globalThis as Record<string, unknown>)[BASE_GLOBAL])
}

/**
 * 拼一个 API 地址。`path` 是 `/api` **之后**的那一段（`/projects`、`/projects/7/logo`…）。
 *
 * **所有** `/api` 拼接都必须经过它，目前的三个调用点：
 * - `fetch`（本文件）
 * - `EventSource`（`features/updates/taskStream.ts`）
 * - `<img src>`（`features/projects/ProjectLogo.tsx`）
 *
 * 各写一份的后果不是报错，而是**悄悄漏掉一处**——而漏掉的那一处只在打包后现形，
 * dev 下永远正常。所以这个函数是这个文件存在的理由。
 */
export function apiUrl(path: string): string {
  // 归一化成「恰好一个前导斜杠」，免得拼出 `//projects` 或 `api/projects`
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}/api${normalized}`
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
  } catch {
    throw new ApiError(0, 'network', '连不上后端，确认 apps/server 还在跑')
  }

  const text = await res.text()
  /*
    响应不一定是 JSON：dev server 正在重启、代理出错、vite 直接回了 index.html
    都会给出 HTML。裸 `JSON.parse` 抛的是 SyntaxError，而调用方到处都在判
    `e instanceof ApiError` —— 这种失败在界面上会**完全静默**（连错误提示都没有）。
    统一包成 ApiError，让它走到正常的错误展示路径上。
  */
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ApiError(
        res.status,
        'bad_response',
        `后端返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`,
      )
    }
  }

  if (!res.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>
    throw new ApiError(
      res.status,
      body.code ?? 'unknown',
      body.message ?? `请求失败（${res.status}）`,
      body.issues ?? [],
    )
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
