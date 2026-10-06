import { useEffect, useRef, useState } from 'react'
import { hasCommand, runCommand } from '@/lib/commands'
import { GLOBAL_COMMANDS } from '@/lib/keys'
import { useUiStore } from '@/store/ui'

/**
 * 菜单栏：文件 / 编辑 / 视图 / 工具 / 帮助。
 *
 * 菜单项**不直接做事**，只调 `runCommand(id)`；行为全在命令注册表里，
 * 快捷键走的也是同一条路。所以菜单上印的组合键不可能和实际生效的对不上——
 * 要改行为只有一处，改完菜单自动跟着变。
 *
 * 菜单栏是桌面软件放「不常用但必须有」动作的地方：打开目录、偏好设置、
 * 全部检查、查看命令日志。网页把它们塞在页面角落里，桌面软件有这一条就够。
 *
 * 暂时只有「设置」是真页面；其余各项先在表里占好位置（置灰不可点），
 * 等对应的功能真的做出来再启用——放一个点了没反应的菜单项比不放更糟。
 */

/** 菜单结构。`command` 为空的分组暂时只显示标题。 */
interface MenuItem {
  label: string
  command?: string
  /** 还没做的动作：显示出来但禁用，并说明为什么 */
  hint?: string
}

const MENUS: { title: string; items: MenuItem[] }[] = [
  {
    title: '文件',
    items: [
      { label: '添加项目…', command: 'open-create' },
      { label: '扫描目录…', command: 'open-scan' },
      { label: '设置…', command: 'open-settings' },
    ],
  },
  {
    title: '编辑',
    items: [
      { label: '搜索项目', command: 'focus-search' },
      { label: '勾选当前清单的全部行', command: 'select-all' },
      { label: '取消选择', command: 'clear-selection' },
    ],
  },
  {
    title: '视图',
    items: [
      { label: '左栏', command: 'toggle-nav' },
      { label: '详情栏', command: 'toggle-detail' },
      { label: '重读本地状态', command: 'refresh-local' },
    ],
  },
  {
    title: '工具',
    items: [
      { label: '联网检查更新', command: 'check-updates' },
      { label: '查看 git 命令日志', hint: '打包成桌面软件后可用' },
    ],
  },
]

/** 反查命令的组合键，给菜单项右侧显示。没绑键就是空串。 */
function comboOfCommand(id: string): string {
  return GLOBAL_COMMANDS.find((c) => c.id === id)?.combo ?? ''
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // 「有没有命令接手」会随挂载变化（清单页挂上才有「全选」），
  // 打开菜单时重算一次就够了，不用订阅。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      // 菜单开着时它自己就是最上层的浮层，全局快捷键已经在让位了
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const navOpen = useUiStore((s) => s.navOpen)
  const detailOpen = useUiStore((s) => s.detailOpen)

  const activate = (item: MenuItem) => {
    setOpen(null)
    if (item.command) runCommand(item.command)
  }

  return (
    <div ref={barRef} className="chrome relative z-30 flex h-7 shrink-0 items-center border-b border-line bg-panel px-1">
      {MENUS.map((menu) => (
        <div key={menu.title} className="relative">
          <button
            onClick={() => setOpen(open === menu.title ? null : menu.title)}
            // 菜单标题本身不进 Tab 序：它是打开某个菜单的方式，
            // 而菜单里的项已经可以 Tab 了。多一个停靠点只是让人多按一次 Tab。
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={open === menu.title}
            className={`cursor-pointer rounded-[3px] px-2 py-0.5 text-[12px] ${
              open === menu.title ? 'bg-accent-wash text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'
            }`}
          >
            {menu.title}
          </button>
          {open === menu.title ? (
            <ul
              role="menu"
              className="absolute left-0 top-full z-30 mt-0.5 min-w-56 border border-line bg-panel py-1 shadow-[0_6px_20px_rgba(19,24,29,0.14)]"
            >
              {menu.items.map((item) => {
                // 没做出来的、或者还没有组件接手的，一律禁用并说明原因。
                // 放一个点了没反应的菜单项比不放更糟。
                const done = item.command !== undefined && hasCommand(item.command)
                const combo = item.command ? comboOfCommand(item.command) : ''
                return (
                  <li key={item.label}>
                    <button
                      role="menuitem"
                      disabled={!done}
                      title={done ? undefined : (item.hint ?? '还没有对应的功能')}
                      onClick={() => activate(item)}
                      className="flex w-full cursor-pointer items-center gap-6 px-3 py-1 text-left text-[12.5px] text-ink hover:bg-accent-wash hover:text-accent disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent"
                    >
                      <span className="flex-1">{item.label}</span>
                      {combo ? (
                        <span className="font-mono text-[11px] text-ink-3">{combo}</span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ))}
      {/* 折叠状态在菜单上要看得见：否则「左栏不见了」会让人以为是坏了 */}
      <span className="ml-auto pr-2 font-mono text-[11px] text-ink-3">
        {[
          !navOpen ? '左栏已折叠' : null,
          !detailOpen ? '详情栏已折叠' : null,
        ]
          .filter(Boolean)
          .join(' · ') || ''}
      </span>
    </div>
  )
}
