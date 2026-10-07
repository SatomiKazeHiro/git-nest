import { Link, useLocation } from 'react-router'
import { FolderGit2, List, Settings } from 'lucide-react'

/**
 * 侧栏：**只有页面**，做成一条 60px 的图标栏（VS Code 活动栏那种）。
 *
 * ```
 * 清单页：| sidebar | filter panel | content |
 * 设置页：| sidebar | content |
 * ```
 *
 * 窄成图标栏有三个好处：
 * - 前面那句「点分类却什么都不换」的落差彻底没了——这一列里**每一项都是
 *   一个页面**，长相统一，本来就不该有别的意思
 * - 省下的 100px 全给了清单与详情：清单那一栏从 412 起，详情 480 不用动
 * - 以后加页面就是加一个图标，**不占横向空间**——十来个页面也不会把窗口挤没
 *
 * 分类 / 标签 / 我自己的在 `features/projects/FilterPanel.tsx`，独立成一条列，
 * 只在清单页存在。
 *
 * 图标没有可见文字，所以每一项都带 `aria-label` 与 `title`：读屏读得到，
 * 鼠标停上去也有名字。选中态用左边一道 2px 竖线（活动栏的老做法），
 * 不用只有底色——底色在 40px 见方的小块上不够显眼。
 */
export function Sidebar() {
  const { pathname } = useLocation()
  const inList = pathname === '/' || pathname.startsWith('/projects/')
  const inSettings = pathname.startsWith('/settings')

  return (
    <nav className="flex min-h-0 flex-col items-center gap-1 py-2">
      {/* 页面。加新页面就是往这里加一个图标。 */}
      <Dest to="/" active={inList} Icon={List} label="清单" />

      {/* 将来别的页面加在这里（跟这条竖线之间就是它们的位置） */}

      {/*
        设置沉底：它是「离开当前清单」的动作。窄栏里不需要分隔线——
        位置（贴底）已经把「上面是页面」说完了。
      */}
      <div className="mt-auto">
        <Dest to="/settings" active={inSettings} Icon={Settings} label="设置" />
      </div>
    </nav>
  )
}

/** 活动栏里的一项：40×40 的图标按钮 + 选中时左边那道竖线。 */
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
      className={`relative flex size-10 cursor-pointer items-center justify-center rounded-[4px] ${
        active ? 'bg-accent-wash text-accent' : 'text-ink-3 hover:bg-paper hover:text-ink-2'
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent ${
          active ? '' : 'hidden'
        }`}
      />
      <Icon size={18} aria-hidden className="shrink-0" />
    </Link>
  )
}
