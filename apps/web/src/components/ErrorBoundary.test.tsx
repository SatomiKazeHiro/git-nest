import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * 全应用原来没有 ErrorBoundary：任何组件渲染期抛异常 = 白屏，
 * 用户看到一片空白，既不知道出了什么事，也没有回去的路。
 *
 * 这里钉住「炸了要给出可读的降级界面 + 回清单的入口」。
 */

afterEach(() => {
  vi.restoreAllMocks()
})

function Boom(): never {
  throw new Error('渲染炸了')
}

describe('ErrorBoundary', () => {
  it('子组件抛错时显示降级界面，而不是把异常抛出去', () => {
    // React 会把错误也 log 到 console；测试里不想看到噪音
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/这一页崩了/)).toBeTruthy()
  })

  it('降级界面上要有回清单的入口', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /清单/ })
    expect(link.getAttribute('href')).toBe('/')
  })

  it('把错误信息也显示出来（本机工具，用户就是开发者）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    )
    expect(screen.getByText(/渲染炸了/)).toBeTruthy()
  })

  it('没出错时照常渲染子组件', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <p>一切正常</p>
        </ErrorBoundary>
      </MemoryRouter>,
    )
    expect(screen.getByText('一切正常')).toBeTruthy()
  })
})
