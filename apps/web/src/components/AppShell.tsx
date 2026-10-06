import type { ReactNode } from 'react'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
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
      {/*
        「编辑资料」弹窗在整个应用里**只挂这一个**。

        它原来被清单页和详情页各渲染了一次——清单页的行上有「编辑资料」，
        详情页顶上也有一个，两处各挂一份是可行的，因为 `formOpen` 是全局的、
        后渲染的那份只是没被看见。但两处挂载本身就是「同一个编辑器、两个门」
        的松散实现：一旦两处同时可见（比如三栏布局）就会有两个实例。
        挂到外壳上，「项目的可写字段只在这里改」这条约定就有了唯一落点。
      */}
      <ProjectFormDialog />
    </div>
  )
}
