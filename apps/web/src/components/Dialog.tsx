import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Loader } from 'lucide-react'
import { Button } from './ui'

/**
 * 通用弹窗。**不认识任何业务**：给它标题与内容，其余全归它管——
 * 遮罩、Escape 关闭、点遮罩关闭、焦点（初始落点 / Tab 圈定 / 关闭后还回去）、
 * **三段式的版式**（头部 / 可滚的内容 / 固定的底部按钮条），以及嵌套时的层级规矩。
 *
 * 消费者只想「里面放什么」。这几件事不该每个弹窗各写一遍——这个仓库已经
 * 踩过一次：自制的那版弹窗没有 Escape、没有初始焦点、也不圈焦点，
 * 于是键盘用户 Tab 一下就跑到底下的清单里去了，而屏幕上没有任何提示。
 *
 * 版式三段（和市面上那套一样）：
 * - **头部**：标题 + 说明 + `actions`（右侧动作）+ 关闭按钮，不滚动
 * - **内容**：`children`，自己滚（长表单滚下去时标题与底部按钮都还在）
 * - **底部**：可选的一条固定带子。三种给法：
 *   1. 标准按钮 —— `confirm`（右边那枚主按钮）+ `cancel`（左边那枚次要按钮）
 *   2. 整条自己画 —— `footer`（给了它，`confirm` / `cancel` 不生效）
 *   3. 不要底部 —— 两者都不给
 *
 * `size`：`default`(32rem) 给表单；`wide`(48rem) 给需要横向空间的内容
 * （表格、报告、设置）。
 */

/** 底部右边那枚主按钮。 */
export interface DialogConfirm {
  text: string
  onClick: () => void
  /** 按钮左边那枚图标（lucide 元素） */
  icon?: ReactNode
  /** `danger` 给「删除 / 移出」这类不可逆的动作 */
  variant?: 'primary' | 'danger'
  disabled?: boolean
  /** 正在处理：禁用并显示转圈（文案仍是你给的那个） */
  loading?: boolean
}

/** 底部左边那枚次要按钮。 */
export interface DialogCancel {
  text?: string
  /** 缺省是 `onClose`——大部分「取消」就是关掉 */
  onClick?: () => void
  icon?: ReactNode
  disabled?: boolean
}

/**
 * 打开着的弹窗。**Escape 与 Tab 只由最上面那个处理**：嵌套时（设置弹窗里再开
 * 一个「移出清单」的确认）两边都在 document 上听着，不判层级的话按一次 Escape
 * 会**把两个一起关掉**，Tab 也会在两个弹窗之间乱跳。
 *
 * 「最上面」不能按打开顺序取，也不能按数组末尾取：内层弹窗在外层的内容里，
 * 它在 React 树上是**子节点**，而**子组件的 effect 先跑**——按顺序取到的
 * 「最后一个」恰好是外层，Escape 就关错了。所以按 **DOM 包含关系**判：
 * 里面还套着别的打开弹窗的那个，不是最上面。
 */
const openPanels: HTMLElement[] = []

function topmostOpenPanel(): HTMLElement | null {
  const outermost = openPanels.filter(
    (panel) => !openPanels.some((other) => other !== panel && panel.contains(other)),
  )
  return outermost[outermost.length - 1] ?? null
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}

export function Dialog({
  title,
  icon,
  description,
  actions,
  footer,
  confirm,
  cancel,
  size = 'default',
  onClose,
  children,
}: {
  title: string
  icon?: ReactNode
  description?: string
  /** 头部右侧、关闭按钮之前的动作（比如「重新检查」）。 */
  actions?: ReactNode
  /**
   * 底部整条自己画。给了它，`confirm` / `cancel` 就不生效。
   * 条子里怎么排由你自己定——这一层只负责那条带子（固定、有上边框、不跟着内容滚）。
   */
  footer?: ReactNode
  /** 底部的**标准按钮**：右边一枚主按钮。不给它（也不给 `footer`）就没有底部条。 */
  confirm?: DialogConfirm
  /** 左边那枚次要按钮：默认「取消」并调 `onClose`；传 `false` 表示不要它。 */
  cancel?: DialogCancel | false
  /** `wide` 给需要横向空间的内容；表单用默认宽度。 */
  size?: 'default' | 'wide'
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  /*
    `onClose` 从 ref 读最新值，而不是进 effect 的依赖。

    调用方全传内联箭头（`onClose={() => …}`），引用每次渲染都变；而更新面板
    每来一个 SSE 事件就重渲染一次 —— effect 跟着重跑的话，每跑一次就把焦点
    抢回弹窗里第一个可聚焦元素。用户正在勾选复选框，焦点一直被打断，
    键盘操作（空格勾选）直接失灵。
    所以：**effect 只在挂载时跑一次**，值从这个 ref 里读。
  */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    openPanels.push(panel)

    /*
      初始焦点给**内容区里第一个可聚焦元素**，不是头部那枚关闭按钮。

      原来用 `panel.querySelector('input, textarea, button')`，而 header 在
      DOM 里排在最前面——命中的永远是关闭按钮。打开一个表单弹窗，用户想敲的是
      第一个字段。
    */
    const first = focusablesIn(contentRef.current)[0] ?? focusablesIn(panel)[0] ?? panel
    first.focus()

    const onKey = (e: KeyboardEvent) => {
      // 只有最上面那个弹窗响应（见 openPanels / topmostOpenPanel 的说明）
      if (topmostOpenPanel() !== panel) return

      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return

      /*
        把 Tab 圈在弹窗里。不圈的话，键盘用户按几下就跑到遮罩**背后**那张
        清单里去了——而屏幕上没有任何东西提示过这件事。
      */
      const items = focusablesIn(panel)
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (!firstEl || !lastEl) {
        e.preventDefault()
        return
      }
      const active = document.activeElement
      if (!panel.contains(active)) {
        e.preventDefault()
        firstEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      } else if (e.shiftKey && active === firstEl) {
        e.preventDefault()
        lastEl.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const at = openPanels.lastIndexOf(panel)
      if (at >= 0) openPanels.splice(at, 1)
      /*
        焦点还回去。不还的话它掉到 `<body>` 上——键盘用户得从头 Tab 一遍
        才能回到刚才那排按钮。
      */
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6 pt-[8vh]"
      onMouseDown={(e) => {
        // 只有点在遮罩**自己**身上才算「点了外面」：从面板里冒泡上来的不算
        if (e.target === e.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`flex max-h-[85vh] w-full flex-col rounded-[4px] border border-line bg-panel shadow-[0_8px_32px_rgba(19,24,29,0.14)] ${
          size === 'wide' ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-1 text-[15px] font-semibold text-ink">
              {icon}
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-[12px] text-ink-3">
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              onClick={onClose}
              aria-label="关闭"
              className="-mr-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[15px] leading-6 text-ink-3 hover:bg-accent-wash hover:text-ink"
            >
              ×
            </button>
          </div>
        </header>

        {/*
          内容区自己滚，标题 / 头部动作 / 关闭按钮 / 底部动作留在原地。
          原来是整个遮罩层滚——长表单滚下去之后标题和关闭按钮都不见了。
        */}
        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/*
          底部那条带子：固定（`shrink-0`）且有上边框，**不在滚动区里**——
          长表单滚下去时，「保存」还在原处。三种给法见文件头。
        */}
        {footer !== undefined ? (
          <footer className="shrink-0 border-t border-line-soft px-5 py-3">{footer}</footer>
        ) : confirm ? (
          <footer className="shrink-0 border-t border-line-soft px-5 py-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {cancel === false ? null : (
                <Button onClick={cancel?.onClick ?? closeRef.current} disabled={cancel?.disabled}>
                  {cancel?.icon}
                  {cancel?.text ?? '取消'}
                </Button>
              )}
              <Button
                variant={confirm.variant ?? 'primary'}
                onClick={confirm.onClick}
                disabled={confirm.disabled === true || confirm.loading === true}
              >
                {confirm.loading ? (
                  <Loader size={14} aria-hidden className="animate-spin" />
                ) : (
                  confirm.icon
                )}
                {confirm.text}
              </Button>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
