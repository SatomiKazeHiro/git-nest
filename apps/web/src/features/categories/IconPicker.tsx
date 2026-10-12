import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { CATEGORY_ICONS, categoryIcon, categoryIconLabel } from './icons'
import { searchCategoryIcons } from './iconSearch'
import { Input } from '@/components/ui'

/**
 * 分类图标选择器：**一枚触发控件 + 点开才出现的浮层**。
 *
 * 上一版是常显网格——那是为了绕开"改名那一行会被撑长"而做的优化，优化错了东西：
 * 用户要的是一个控件。现在触发控件只占一行高，浮层按需弹出来，改名行也回到正常行高。
 *
 * ## 为什么是 portal + `position: fixed`
 * 设置弹窗的**内容区是可滚动的**，所以 `position: absolute` 挂在触发点下面的浮层
 * 会被那一层 `overflow` **裁掉**（网格 224px 高，而触发点常常就在底部）。因此：
 * portal 到 `document.body`（逃出裁切），坐标用触发元素的 **`getBoundingClientRect()`**
 * 算，`fixed` 定位；**下面放不下时向上翻**——向上时用 `bottom` 锚定，
 * 这样不必知道浮层实际多高（搜索结果少的时候它是矮的）。
 *
 * ## 滚动/缩放：**关掉**，不重算
 * 两条路都能走，这里选"关掉"。理由：滚动时锚点在连续移动，重算得跟着 rAF 节流、
 * 每次滚动都读写布局；而**这个控件的寿命只有几秒**（选一个图标就走），关掉更便宜、
 * 也不可能漂移。缩放同理。滚动监听挂在**捕获阶段**（`true`），这样设置弹窗内部那个
 * 可滚动容器的滚动也能收到——否则它滚了、浮层还杵在原地，那才是真的错得离谱。
 *
 * ## 无障碍
 * 触发控件 `aria-expanded` + `aria-controls`；浮层 `role="dialog"` +
 * `aria-label="选择图标"`；打开时焦点进搜索框（`autoFocus`），**Escape 关闭并把焦点
 * 还给触发控件**；点外面也关闭（那条路上焦点跟着点击走，不抢回来）。**没有遮罩**——
 * 它是一枚锚定控件，不是抽屉。
 */
export function IconPicker({
  value,
  onChange,
}: {
  /** 当前选中的图标名；`null` = 没有图标 */
  value: string | null
  onChange: (icon: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const found = searchCategoryIcons(query)
  const CurrentIcon = categoryIcon(value)

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return

    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const PANEL_H = 264 // 搜索行 + 12rem 网格 + 「不选图标」行，估的
      const width = Math.min(340, window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom
      const up = below < PANEL_H + 8 && rect.top > below
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
      setPos(
        up ? { bottom: window.innerHeight - rect.top + 8, left } : { top: rect.bottom + 8, left },
      )
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 捕获阶段拦下来：否则设置弹窗自己也会收到这个 Escape，两个一起关
      e.stopPropagation()
      close()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    const onMove = () => close(false)

    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const pick = (icon: string | null) => {
    onChange(icon)
    close()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        /*
          **可访问名字要带前缀**：网格里那一项的名字就是「打开的书」，触发控件如果
          也叫这个，读屏用户列按钮时会听到两个同名按钮而无从分辨（视觉上还好——一个
          在浮层里、一个是当前值）。触发控件说的是"现在选的是哪个"，网格项说的是
          "可以选哪个"，名字要把这层差别带出来。**视觉文案一个字没改**。
        */
        aria-label={CurrentIcon ? `当前图标：${categoryIconLabel(value)}` : '选择图标'}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[3px] border border-line bg-panel px-2 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink"
      >
        {CurrentIcon ? <CurrentIcon size={15} aria-hidden /> : null}
        <span>{CurrentIcon ? categoryIconLabel(value) : '选择图标'}</span>
        <ChevronDown size={13} aria-hidden className="text-ink-3" />
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="选择图标"
              style={{
                position: 'fixed',
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: 340,
                zIndex: 60,
              }}
              className="rounded-[3px] border border-line bg-panel p-2 shadow-lg"
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜图标（中文或英文）"
                aria-label="搜索图标"
                className="!w-full"
                /* 打开就把焦点送进搜索框——用户下一步几乎一定是打字 */
                autoFocus
              />

              <div className="mt-2 grid max-h-48 grid-cols-8 gap-1 overflow-auto rounded-[3px] border border-line bg-bg p-1.5">
                {found.length === 0 ? (
                  /* 搜不到时给一句话，而不是一个空网格（那看着像"图标丢了"） */
                  <p className="col-span-8 px-1 py-2 text-[12px] text-ink-3">
                    没有匹配的图标，换个词试试（中文英文都行）
                  </p>
                ) : (
                  found.map((entry) => {
                    const Icon = CATEGORY_ICONS[entry.key].Icon
                    const active = value === entry.key
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        /* 念中文名：屏幕阅读器念 `book-open` 等于没念 */
                        aria-label={entry.label}
                        aria-pressed={active}
                        title={entry.label}
                        onClick={() => pick(active ? null : entry.key)}
                        className={`flex aspect-square cursor-pointer items-center justify-center rounded-[3px] border ${
                          active
                            ? 'border-accent bg-accent-wash text-accent'
                            : 'border-transparent text-ink-2 hover:border-line hover:bg-sunken hover:text-ink'
                        }`}
                      >
                        <Icon size={16} aria-hidden />
                      </button>
                    )
                  })
                )}
              </div>

              {/* 图标是可选的，所以「不选图标」必须在浮层里有一项（点完即关） */}
              <button
                type="button"
                onClick={() => pick(null)}
                className="mt-2 w-full cursor-pointer rounded-[3px] border border-line px-2 py-1 text-left text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                不选图标
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
