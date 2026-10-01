import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * 渲染期异常的兜底。
 *
 * 原来全应用没有 ErrorBoundary：任何组件在渲染时抛异常（比如某处对 undefined
 * 解构）就是**白屏** —— 用户看到一片空白，既不知道出了什么事，也没有回去的路。
 * 本机单用户工具，用户就是开发者，所以直接把错误信息摊开给他看，比藏起来有用。
 *
 * 这是 React 的 class 组件 API（函数组件至今没有等价物）：
 * `getDerivedStateFromError` 负责切换到降级 UI，`componentDidCatch` 负责记录。
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 本机工具没有上报服务，留在控制台供排查
    console.error('渲染出错：', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div role="alert" className="mx-auto max-w-prose px-6 py-10">
        <p className="text-[15px] font-semibold text-signal-bad">这一页崩了</p>
        <p className="mt-2 text-[13px] text-ink-2">
          是渲染时抛的异常，多半是某个组件拿到了没料到的数据。刷新一下通常能恢复；
          如果一直这样，下面这行信息就是排查线索。
        </p>
        <pre className="mt-3 overflow-x-auto rounded-[3px] border border-line bg-panel px-3 py-2 font-mono text-[12px] text-ink-2">
          {error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <Link
            to="/"
            className="rounded-[3px] border border-line bg-panel px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            回清单
          </Link>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-[3px] border border-line bg-panel px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            再试一次
          </button>
        </div>
      </div>
    )
  }
}
