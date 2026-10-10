import { useRef } from 'react'

/**
 * 标签栏。**通用件**（所以在 `components/` 而不是某个 feature 下）：
 * 它只管「切」，不管内容，也不认识任何业务类型——`tabs` 是外面传进来的。
 *
 * **切换不改 URL**：以详情栏那两页为例，「正在看哪个项目」住在 URL 里
 * （`/projects/:id`），而「看它的哪一页」是这一次看的局部状态。改了 URL 的话
 * 浏览器的前进后退就会开始记录「我翻到第几页」，而那不是一个值得记的动作。
 *
 * 键盘：左右方向键在几个之间移动，Home / End 跳首尾；未选中的那些 `tabIndex=-1`，
 * 所以整组只占 Tab 序里的一个停靠点（与清单表那个 roving tabindex 同一套想法）。
 *
 * 选中态用**蓝**——蓝在这个应用里表示「你能点的 / 当前选中的」。
 *
 * 面板那头有两条约定（消费者负责）：未选中的面板用 `hidden` 藏着而不是不渲染
 * （不渲染的话 `aria-controls` 会指向一个不存在的 id），以及面板要 `tabIndex={0}`
 * 留一个键盘落点。
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = tabs.findIndex((t) => t.key === value)
  const go = (next: number) => {
    const t = tabs[next]
    if (!t) return
    onChange(t.key)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-4">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          role="tab"
          ref={(el) => {
            refs.current[i] = el
          }}
          aria-selected={t.key === value}
          aria-controls={`panel-${t.key}`}
          id={`tab-${t.key}`}
          tabIndex={t.key === value ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); go((at + 1) % tabs.length) }
            if (e.key === 'ArrowLeft') { e.preventDefault(); go((at - 1 + tabs.length) % tabs.length) }
            if (e.key === 'Home') { e.preventDefault(); go(0) }
            if (e.key === 'End') { e.preventDefault(); go(tabs.length - 1) }
          }}
          className={`-mb-px cursor-pointer border-b-2 px-2 py-1.5 text-[12.5px] ${
            t.key === value
              ? 'border-accent font-medium text-accent-ink'
              : 'border-transparent text-ink-3 hover:text-ink-2'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
