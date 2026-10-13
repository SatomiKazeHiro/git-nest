import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'

/**
 * 共用的下拉：**一枚触发控件 + 点开才出现的浮层**，单选、可清空、每一项可以带图标。
 *
 * ## 为什么不用原生 `<select>`
 *
 * 原生 `<option>` 里**画不了东西**：分类是带图标的（`features/categories/icons.tsx`），
 * 而 `<select>` 只能给文字。要在这里也看见图标，就只有「自己画一个 listbox」这一条路。
 * 另外原生控件还有两处够不着：触发控件上没法放一枚 ×（清空），浮层的样子也完全不跟着
 * 主题走。
 *
 * 代价写在这里，免得下一个人以为是白拿的：**原生弹出菜单白送的那些东西都没有了**——
 * 手机上的系统滚轮、`<optgroup>`、输入法首字母跳转、长列表由浏览器自己滚。所以这个
 * 组件只该给「选项几十项以内、需要图标或需要清空」的地方用；纯粹从一长串文字里挑一个
 * 的场景，原生 `<select>` 更划算。
 *
 * ## 浮层：照 `features/categories/IconPicker.tsx` 踩出来的坑走
 *
 * 那里面每一条都是踩出来的，这里不重新发明：
 *
 * - **portal 到 `document.body` + `position: fixed`**：调用方可能在弹窗的**可滚动
 *   内容区**里（分类那一格就是），`absolute` 会被那一层的 `overflow` 裁掉。
 * - **下面放不下就向上翻**：坐标由触发元素的 `getBoundingClientRect()` 算，向上时用
 *   `bottom` 锚定，于是不必知道浮层实际多高。
 * - **滚动/缩放时重新定位，绝不关闭**：监听挂捕获阶段（弹窗内部那个滚动容器也要收到），
 *   但 `event.target` 落在浮层或触发控件里就整个忽略——锚点没动。一帧最多算一次。
 * - **关闭只有四条**：Escape、点外面、点中某一项、再点触发控件。Escape 在捕获阶段
 *   `stopPropagation`，否则弹窗自己也会收到这个 Escape，两个一起关。
 *
 * ## 焦点与键盘：选的是「焦点进列表」，不是 `aria-activedescendant`
 *
 * 两条路 ARIA 都认，这里选前者：浮层一打开就把焦点交给 `role="listbox"` 这个容器
 * （`tabIndex={-1}`），上下键在它里面移动「高亮的那一项」。理由是
 * `aria-activedescendant` 要靠 `id` 把「容器上的活动项」和「某一项」绑起来——选项
 * 列表一变就要重新对齐这些 id，而这一处的列表本来就会变（分类接口回来之后从兜底四个
 * 换成真实名单）。焦点在容器上则没有这层同步：换一批选项，高亮跟着 `value` 重算就行。
 *
 * **上下键会 `preventDefault`**：不拦浏览器就拿它滚页面。键盘只在**焦点位于浮层里**
 * 时处理 Enter/Space——触发控件自己那枚按钮的原生行为（Enter/Space = 点一下）就够了，
 * 两边都管的话一次回车会先选中、再被 `onClick` 关掉。
 *
 * ## 空值
 *
 * `value === ''` 与 `value === undefined` 都表示**没有选中**，触发控件上显示
 * `placeholder`。`''` 也算空，是因为分类那一格的空值就是空串（库里存的就是它），
 * 调用方不该为了用它把空值转成 `null` 再转回来。
 *
 * **「没有选中」只有一份表示**：占位由触发控件承担，浮层里不再画一枚空选项。这一条是
 * 踩出来的——上一版原生下拉里，除了「未分类」那枚固定选项，兜底那一支又给空值画了
 * 第二枚 `value=''` 的选项，用户看到「未分类」下面挂着一个空白项。要「清空」这个动作
 * 的地方用 `clearable`，那枚 × 才是它的入口。
 */

/** 浮层里的一项。`label` 是给人看的；`value` 才是提交出去的那个。 */
export interface SelectOption {
  value: string
  label: string
  /** 图标元素（lucide 组件）。给了就画在文字左边，触发控件上也画同一枚。 */
  icon?: ReactNode
}

interface SelectProps {
  options: SelectOption[]
  /** 当前值。`''` 或 `undefined` = 没选中（触发控件上显示 `placeholder`） */
  value: string | undefined
  onChange: (value: string) => void
  /** 没选中时触发控件上那句话（例如「未分类」）。不给就只剩一枚箭头 */
  placeholder?: string
  /** 显示一枚 × 用来清回空值。**清空没有意义的地方别开**（例如「排序」） */
  clearable?: boolean
  /**
   * 这一格的可访问名字（例如「分类」）。它同时是浮层的名字。
   *
   * ⚠️ **它只给「这一格是什么」，不要写成「当前选的是哪个」**：给了它，触发控件上的
   * 可见文字就不再是可访问名字的一部分了（`aria-label` 优先于内容）。所以清空那枚
   * × 自己会拼出「清空分类」——读屏用户才知道清的是哪一个下拉。
   */
  'aria-label': string
  /**
   * 触发控件的 `id`。`Field` 生成的 `htmlFor` 要落到真正可聚焦的那个元素上，
   * 不然点 label 没反应、`getByLabelText` 也找不着它。
   */
  id?: string
  className?: string
}

export function Select({
  options,
  value,
  onChange,
  placeholder,
  clearable = false,
  'aria-label': ariaLabel,
  id,
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{
    top?: number
    bottom?: number
    left: number
    width: number
  } | null>(null)
  /*
    高亮项用**值**记，不记下标：选项列表会在打开期间换一份（分类接口回来时从兜底四个
    换成真实名单），记下标的话高亮会滑到另一项上去。
  */
  const [active, setActive] = useState<string | null>(null)
  /*
    定位的基准是**那个有边框的整块控件**，不是里面那枚按钮。
    用户眼里的「输入框」就是这一块（`border` 画在它身上），所以浮层必须与它左对齐、
    同宽；按里面那枚按钮去算，按钮的右边缘还空着 × 与 v 的位置，浮层就会比控件窄、
    左边缘也跟着偏（用户看到的就是「面板没和输入框对齐」）。
  */
  const controlRef = useRef<HTMLDivElement>(null)
  /** 里面那枚按钮：焦点还给它，点击也归它（v 是它的一部分，见下面的结构） */
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // 空串与 undefined 是同一件事（见文件头「空值」那一节）
  const isEmpty = value === undefined || value === ''
  const current = isEmpty ? undefined : options.find((o) => o.value === value)
  const selectedValue = current?.value ?? null

  /*
    `active` 与 `options` 从 ref 里读，不进下面那个 effect 的依赖。
    进了的话，鼠标每划过一项（`onMouseEnter` 改 `active`）都要把四个 document 监听
    拆一遍再装一遍——用户正拖着鼠标，装拆之间那一小段窗口里事件是没人接的。
  */
  const activeRef = useRef<string | null>(null)
  activeRef.current = active
  const optionsRef = useRef(options)
  optionsRef.current = options

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  /** 选中某一项：**先关、再还焦点、最后才报值** */
  const pick = (v: string) => {
    setOpen(false)
    /*
      先焦点后回调：`onChange` 会让父组件重渲染，重渲染有可能把这个控件整体换掉
      （比如换了 key）。放在它之后，这枚焦点就落在一个已经不在文档里的节点上了。
    */
    triggerRef.current?.focus()
    onChange(v)
  }

  /** 打开。高亮从**当前选中项**开始，没有选中就从第一项开始。 */
  const openList = () => {
    setActive(selectedValue ?? optionsRef.current[0]?.value ?? null)
    setOpen(true)
  }

  /*
    焦点进浮层。放在 effect 里（而不是渲染时）是因为浮层要等 portal 挂上才有节点；
    `pos` 算出来之前浮层不渲染，所以跟着 `pos` 一起等。
  */
  useEffect(() => {
    if (open && pos) listRef.current?.focus()
  }, [open, pos])

  useEffect(() => {
    if (!open) return

    const LIST_MAX_H = 264 // 浮层最多这么高，只用来决定往上还是往下
    const GAP = 4 // 控件与浮层之间的缝
    const MARGIN = 8 // 离窗口边缘至少留这么多
    const MIN_W = 176 // 浮层再窄也留这么宽：比它更窄时选项文字会被截得看不出是什么
    const reposition = () => {
      /*
        量的是**有边框的整块**（`controlRef`）。浮层与它左对齐、同宽——这一点是
        「面板和输入框没对齐」那个 bug 的正面修法：量里面那枚按钮的话，它的右边缘
        还空着 × 与 v 的位置，浮层自然窄一截、左边缘也偏。
      */
      const rect = controlRef.current?.getBoundingClientRect()
      if (!rect) return
      // 可以比控件宽（选项文字更长时读得全），但**左边缘一定与控件齐**
      const room = window.innerWidth - 2 * MARGIN
      const width = Math.min(Math.max(MIN_W, rect.width), room)
      const below = window.innerHeight - rect.bottom
      // 下面放不下就向上翻。**翻的是上下，横向一个字都不动**
      const up = below < LIST_MAX_H + GAP && rect.top > below
      const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - width - MARGIN))
      setPos(
        up
          ? { bottom: window.innerHeight - rect.top + GAP, left, width }
          : { top: rect.bottom + GAP, left, width },
      )
    }
    reposition()

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as Node | null
      const inList = target !== null && listRef.current?.contains(target) === true
      const inTrigger = target !== null && triggerRef.current?.contains(target) === true
      if (!inList && !inTrigger) return

      if (e.key === 'Escape') {
        /*
          捕获阶段拦下来：弹窗自己也在 document 上听着 Escape，不拦就会把**两个**
          一起关掉（这一条在 IconPicker 里踩过）。
        */
        e.stopPropagation()
        close()
        return
      }
      // Enter / Space 只归浮层管：触发控件自己那枚按钮的原生行为就够了
      if (!inList) return

      const current = optionsRef.current
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // **必须拦**：不拦浏览器就拿它滚页面
        e.preventDefault()
        if (current.length === 0) return
        const at = current.findIndex((o) => o.value === activeRef.current)
        // 没找到（列表刚换过）就从第一项开始，而不是什么都不做
        const step = e.key === 'ArrowDown' ? 1 : -1
        const next = at === -1 ? 0 : (at + step + current.length) % current.length
        setActive(current[next]?.value ?? null)
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        const v = activeRef.current
        if (v !== null) pick(v)
        return
      }
      /*
        其余按键都别漏给外面：外面的弹窗在同一个 document 上听着自己的键，
        漏下去就是「在列表里敲了一下，外面的弹窗跟着动了」。Tab 例外，放它走。
      */
      if (e.key !== 'Tab') e.stopPropagation()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      // 点外面也关。焦点跟着点击走，不抢回来——抢了等于跟用户对着干
      close(false)
    }

    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        reposition()
      })
    }
    const onScroll = (e: Event) => {
      // 浮层自己（或触发控件）里的滚动：锚点没动，什么都不用做
      const target = e.target as Node | null
      if (target && (listRef.current?.contains(target) || triggerRef.current?.contains(target))) {
        return
      }
      schedule()
    }

    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', schedule)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [open])

  return (
    <>
      {/*
        **这一整块（含边框）就是那个控件**：里面依次是 `[图标][文字]` ……… `[×]` `[v]`。
        浮层的定位基准也是它（`controlRef`），所以面板与它左对齐、同宽。

        三条约束，每一条都有理由：

        - **v 在最右边、且只是装饰**：它自己**不接** `onClick`——命中的是它左边那块
          触发按钮（点 v 的区域＝点按钮）。单独给它接一个的话，一次点击会同时命中它和
          下面那层按钮，两次切换等于没反应（这个坑踩过一次）。
        - **× 紧挨在 v 左边，而且不打开面板**：× 是**触发按钮的兄弟**（不是孙子），
          点它不会冒泡到那枚按钮，所以「清空」不会顺手把列表打开。
        - **× 不显示时 v 仍在最右边、位置不跳**：× 给固定尺寸（`w-4`），它出现与消失
          只影响自己那一格。
      */}
      <div
        ref={controlRef}
        className={`flex h-7 items-center gap-1.5 rounded-[3px] border border-line bg-panel pr-2 pl-2 focus-within:border-accent ${className}`}
      >
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? close() : openList())}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[13px] focus:outline-none ${
            isEmpty ? 'text-ink-3' : 'text-ink'
          }`}
        >
          {current?.icon ? <span className="shrink-0 text-ink-2">{current.icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{isEmpty ? placeholder : current?.label}</span>
        </button>

        {clearable && !isEmpty ? (
          <button
            type="button"
            /*
              可访问名字要说清是清**哪一个**控件：一屏里可能有好几个下拉，光念「清空」
              读屏用户不知道清的是谁，所以把 `aria-label` 那份名字带进来。
            */
            aria-label={`清空${ariaLabel}`}
            title="清空"
            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-ink-3 hover:text-ink"
            onClick={() => {
              /* 焦点先留在这一格上（清完可能还要再选），再把值清掉 */
              triggerRef.current?.focus()
              onChange('')
            }}
          >
            <X size={12} aria-hidden />
          </button>
        ) : null}

        {/* v 在 × **右边**：这两枚谁先谁后是用户报过的坑，DOM 次序就按看到的次序排 */}
        <ChevronDown size={13} aria-hidden className="shrink-0 text-ink-3" />
      </div>

      {open && pos
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              tabIndex={-1}
              style={{
                position: 'fixed',
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                zIndex: 60,
              }}
              className="overflow-y-auto rounded-[3px] border border-line bg-panel p-0.5 shadow-lg focus:outline-none"
            >
              {options.length === 0 ? (
                /* 名单是空的就说一句，而不是给一块空白（那看着像「坏了」） */
                <p className="px-2 py-1.5 text-[12px] text-ink-3">没有可选项</p>
              ) : (
                options.map((o) => {
                  const selected = o.value === selectedValue
                  const highlighted = o.value === active
                  return (
                    <div
                      key={o.value}
                      role="option"
                      aria-selected={selected}
                      /* 高亮跟着鼠标走：键盘和鼠标操作的是同一份状态，指到哪项就选中哪项 */
                      onMouseEnter={() => setActive(o.value)}
                      onClick={() => pick(o.value)}
                      data-highlighted={highlighted ? 'true' : undefined}
                      data-selected={selected ? 'true' : undefined}
                      className="select-item flex cursor-pointer items-center gap-1.5 rounded-[2px] px-2 py-1 text-[13px]"
                    >
                      {o.icon ? <span className="shrink-0">{o.icon}</span> : null}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    </div>
                  )
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
