import type { ApiErrorBody } from '@git-nest/core'

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
    res = await fetch(`/api${path}`, {
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
