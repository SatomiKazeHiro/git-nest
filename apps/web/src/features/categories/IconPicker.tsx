import { useState } from 'react'
import { CATEGORY_ICONS } from './icons'
import { searchCategoryIcons } from './iconSearch'
import { Input } from '@/components/ui'

/**
 * 分类图标选择器：**内联展开 + 自带滚动**，不是浮层也不是弹窗。
 *
 * 为什么不做成浮层：设置里那一行不能被它撑高，而浮层要引入遮罩——那套东西用户
 * 明确不喜欢（会吃掉第一次点击）。所以这里是一个**有最大高度、自己滚**的网格：
 * 12rem 大约四行，94 个图标翻着看，设置弹窗的高度一点不变。
 *
 * 三件事必须一起成立，缺一个这个控件就不好用：
 * - **能搜**：94 个图标靠翻是找不到的。搜索走 `searchCategoryIcons`（key / 中文名 /
 *   关键词三处匹配），不在这里另写一遍过滤——那必然两处漂开（`icons.test.ts` 钉着它）。
 * - **能清**：图标是可选的，所以有明确的「不设图标」（清掉就是 `null`），
 *   再点一次已选中的那个也等于清掉。
 * - **能读**：每个按钮的 `aria-label` 是**中文名**（不是 `book-open` 这种 key）——
 *   屏幕阅读器念 key 等于没念。
 */
export function IconPicker({
  value,
  onChange,
}: {
  /** 当前选中的图标名；`null` = 不设图标 */
  value: string | null
  onChange: (icon: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const found = searchCategoryIcons(query)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜图标（中文或英文）"
          aria-label="搜索图标"
          className="!w-44"
        />
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={value === null}
          className="cursor-pointer rounded-[3px] border border-line px-2 py-1 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink disabled:cursor-default disabled:text-ink-3 disabled:hover:border-line"
        >
          不设图标
        </button>
        <span className="font-mono text-[11px] text-ink-3">
          {found.length} / {Object.keys(CATEGORY_ICONS).length}
        </span>
      </div>

      <div className="grid max-h-48 grid-cols-8 gap-1 overflow-auto rounded-[3px] border border-line bg-panel p-1.5">
        {found.length === 0 ? (
          /* 搜不到时说清楚，而不是给一个空网格（那看着像"图标丢了"） */
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
                onClick={() => onChange(active ? null : entry.key)}
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
    </div>
  )
}
