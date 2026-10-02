import { NavLink } from 'react-router'
import type { ReactNode } from 'react'
import { List, Settings } from 'lucide-react'
import { NestMark } from './NestMark'

/**
 * 导航项的图标。
 *
 * 尺寸 14 是配正文 13px 的：图标只用 lucide 的默认描边、不额外放大，
 * 免得顶栏那行字被图标顶得忽高忽低。
 */
const NAV = [
  { to: '/', label: '清单', end: true, Icon: List },
  { to: '/settings', label: '设置', end: false, Icon: Settings },
]

export function AppShell({ sidebar, children }: { sidebar?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-6 border-b border-line bg-panel px-6 py-2.5">
        <a href="/" className="flex items-center gap-2">
          <NestMark />
          <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">git-nest</span>
          <span className="hidden text-[12px] text-ink-3 sm:inline">本地仓库清单</span>
        </a>
        <nav className="ml-auto flex items-center gap-1">
          {NAV.map(({ to, label, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-[13px] ${
                  isActive ? 'bg-accent-wash text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'
                }`
              }
            >
              <Icon size={14} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="flex flex-1">
        {sidebar ? (
          <aside className="hidden w-52 shrink-0 border-r border-line bg-panel px-4 py-5 lg:block">
            {sidebar}
          </aside>
        ) : null}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
