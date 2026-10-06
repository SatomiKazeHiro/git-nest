import type { ReactNode } from 'react'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

/**
 * 窗口外壳：标题栏 / 主体（导航栏 + 内容区）/ 状态栏。
 *
 * **根节点不滚。** 原来这里是 `min-h-screen flex-col` + 粘性顶栏，也就是一个
 * 会滚的网页文档：页面自己滚、顶栏浮在上面、选中提示浮在底部。
 * 桌面软件的窗口是固定的一屏，纵向空间由三段（标题 / 主体 / 状态）占掉，
 * 滚动只发生在「主体」里面——所以真正要滚的是哪一栏，取决于它有多长，
 * 而不是取决于谁加了 `sticky`。
 *
 * 布局规则都写在 `index.css` 的「窗口骨架」一节里（`.app` / `.body` / `.nav`），
 * 这里只负责把带拼起来。
 */
export function AppShell({ sidebar, children }: { sidebar?: ReactNode; children: ReactNode }) {
  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        {sidebar ? (
          <aside className="nav border-r border-line bg-panel">{sidebar}</aside>
        ) : null}
        <main className="content">{children}</main>
      </div>
      <StatusBar />
    </div>
  )
}
