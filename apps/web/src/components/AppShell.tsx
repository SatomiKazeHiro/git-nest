import { NavLink } from 'react-router'
import type { ReactNode } from 'react'
import { NestMark } from './NestMark'

const NAV = [
  { to: '/', label: '清单', end: true },
  { to: '/settings', label: '设置', end: false },
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
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-[3px] px-2.5 py-1 text-[13px] ${
                  isActive ? 'bg-accent-wash text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'
                }`
              }
            >
              {item.label}
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
