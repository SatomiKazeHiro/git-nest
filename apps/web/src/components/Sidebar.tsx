import { Link, useLocation } from 'react-router'
import { FolderGit2, List, Settings } from 'lucide-react'

/**
 * 侧栏：**只有页面**，一条 48px 的图标栏（VS Code 活动栏那种）。
 *
 * ```
 * 清单页：| sidebar | filter panel | content |
 * 设置页：| sidebar | content |
 * ```
 *
 * 窄成图标栏有三个好处：
 * - 前面那句「点分类却什么都不换」的落差彻底没了——这一列里**每一项都是
 *   一个页面**，长相统一，本来就不该有别的意思
 * - 省下的横向空间全给了清单与详情
 * - 以后加页面就是加一个图标，**不占横向空间**——十来个页面也不会把窗口挤没
 *
 * 分类 / 标签 / 我自己的在 `features/projects/FilterPanel.tsx`，独立成一条列，
 * 只在清单页存在。
 *
 * 选中态只有一层底色 + 图标变色：48px 宽的栏里已经没有多少余地了，
 * 再加一道竖线反而像多了个东西。
 *
 * 图标没有可见文字，所以每一项都带 `aria-label` 与 `title`：读屏读得到，
 * 鼠标停上去也有名字。
 */
export function Sidebar() {
  const { pathname } = useLocation()
  const inList = pathname === '/' || pathname.startsWith('/projects/')
  const inSettings = pathname.startsWith('/settings')

  return (
    <nav className="flex min-h-0 flex-col items-center gap-1 py-2">
      {/*
        页面。清单只是其中一项，将来别的页面就加在这儿——
        它长得一样、行为也一样（点它换一页），不需要特殊对待。
      */}
      <Dest to="/" active={inList} Icon={List} label="清单" />

      {/*
        `mt-auto` 把设置顶到最底下——它和「清单」不是一个层级的东西：
        上面是浏览各个页面，设置是「离开当前清单去改配置」。
        （`mt-auto` 在纵向 flex 里就等于一个撑开的弹性段；不必再插一个空的
        `flex-1` 元素。）
      */}
      <div className="mt-auto">
        <Dest to="/settings" active={inSettings} Icon={Settings} label="设置" />
      </div>
    </nav>
  )
}

/** 活动栏里的一项：36×36 的图标按钮。 */
function Dest({
  to,
  active,
  Icon,
  label,
}: {
  to: string
  active: boolean
  Icon: typeof FolderGit2
  label: string
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
      className={`flex size-9 cursor-pointer items-center justify-center rounded-[4px] ${
        active ? 'bg-accent-wash text-accent' : 'text-ink-3 hover:bg-paper hover:text-ink-2'
      }`}
    >
      <Icon size={18} aria-hidden className="shrink-0" />
    </Link>
  )
}