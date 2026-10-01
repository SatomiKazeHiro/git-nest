import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

/**
 * 浏览器里没有 EventSource（jsdom 不实现），而更新进度就靠它。
 * 这里给一个可控的假实现：测试自己决定「什么时候推什么事件」，
 * 比真 SSE 好测——不会有时序抖动。
 */
import { act } from 'react'

export class FakeEventSource {
  static instances: FakeEventSource[] = []

  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
    // 同步触发，不引入定时器——测试里不该有隐形的等待
    this.onopen?.()
  }

  /** 由测试调用：推一条消息（包在 act 里，否则 React 会警告） */
  emit(payload: unknown) {
    act(() => {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }))
    })
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (type === 'message') this.onmessage = fn
  }

  close() {
    this.closed = true
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __IS_REACT_ACT_ENVIRONMENT__: boolean
}

globalThis.__IS_REACT_ACT_ENVIRONMENT__ = true

beforeAll(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  // msw 3.x 里这个选项叫 onUnhandledFrame（2.x 时叫 onUnhandledRequest）：
  // 测试里遇到没 mock 的请求直接报错，免得“测试通过但根本没打到接口”
  server.listen({ onUnhandledFrame: 'error' })
  window.scrollTo = () => {}
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  FakeEventSource.instances = []
})

afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})
