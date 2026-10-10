import type { ReactNode } from 'react'
import { TitleBar } from '@/components/TitleBar'

/**
 * 窗口外壳：标题栏 / 主体。
 *
 * **根节点不滚。** 原来这里是 `min-h-screen flex-col` + 粘性顶栏，也就是一个
 * 会滚的网页文档：页面自己滚、顶栏浮在上面、选中提示浮在底部。
 * 桌面软件的窗口是固定的一屏，纵向空间由两条带（标题 / 主体）占掉，
 * 滚动只发生在「主体」里面——所以真正要滚的是哪一栏，取决于它有多长，
 * 而不是取决于谁加了 `sticky`。
 *
 * 布局规则都写在 `index.css` 的「窗口骨架」一节里，这里只负责把带拼起来。
 *
 * **为什么这个文件在 `layouts/` 而不是 `components/`**：`components/` 是通用层
 * （按钮、弹窗、图标），它必须能不认识任何 feature——否则「通用层 → 业务」这条
 * 反向依赖就会出现，而这个仓库已经踩过一次（「编辑资料」弹窗曾挂在这个文件里，
 * 于是通用层认识了 `features/projects`）。外壳不是通用组件：它是这一屏的骨架，
 * 将来也可能要拼装业务组件。所以它在布局这一层。
 * 分开放，是为了让那条规矩**一眼看得出来**，而不是靠人记着。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
