import { Outlet } from 'react-router'
import { List } from 'lucide-react'
import { ProjectsPage } from './ProjectsPage'

/**
 * 清单工作区：**清单表 + 右边的详情栏**，同屏常驻。
 *
 * 桌面软件的老规矩是 master-detail——点一行，右边当场展开，而不是整页跳走再跳回来。
 * 清单能有多大、一次要点几个项目，决定了「看一眼就得回去」是不是个真问题：
 * 跑一轮批量检查、挨个看推荐、挑几个更新，来回跳十几次的话往返本身就成了负担。
 *
 * 路由上只有一个 workspace：`/` 和 `/projects/:id` 渲染的是同一个界面，
 * 区别只在右边那栏有没有内容。所以深链（书签、外部跳转、浏览器前进后退）照旧有效，
 * 打开 `/projects/5` 就是「清单 + 5 号项目的详情」。
 */
export function Workspace() {
  return (
    <div className="split">
      <ProjectsPage />
      <aside className="detail border-l border-line bg-panel">
        <Outlet />
      </aside>
    </div>
  )
}

/**
 * 右边还没选中任何项目时的样子。
 *
 * 给一句「点一行看详情」而不是留一片空白：空白看着像卡住了。
 */
export function DetailPlaceholder() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 px-6 py-8">
      <List size={20} aria-hidden className="text-ink-3" />
      <p className="text-[13px] font-medium text-ink-2">还没选中项目</p>
      <p className="max-w-prose text-[12.5px] text-ink-3">
        在左边点一行，这里会显示它的本地路径、git 状态，以及你写的那段记录。
      </p>
    </div>
  )
}
