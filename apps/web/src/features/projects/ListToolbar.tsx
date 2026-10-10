import type { ReactNode } from 'react'
import { Eraser, FolderSearch, Plus, RefreshCw } from 'lucide-react'
import { CATEGORIES, categoryLabel, type Attention, type ProjectSort } from '@git-nest/core'
import { Button, Input } from '@/components/ui'
import { GLOBAL_COMMANDS } from '@/lib/keys'
import { hasFilter, useUiStore } from '@/store/ui'

/**
 * 清单页的两个控件行：**工具条**（搜索 / 计数 / 三个动作）与**列表头**
 *（状态 / 分组 / 排序 + 快捷键提示）。
 *
 * 它们与左栏的过滤面板**读写同一份 `filters`**（store）。两边都留着是为了对比，
 * 所以它们必须是一份状态：各存一份的话，改了这边另一边不亮，用户会以为它们
 * 各筛各的。
 *
 * 两行放一个文件，是因为它们共用同一套控件语汇——`Sel` 只给列表头用，但两行的
 * 高度、分隔线与配色是同一组约定（见 `index.css`），拆开反而要让 `Sel` 另找家。
 */

/**
 * 工具条：搜索 / 计数 / 三个动作。
 *
 * 逐个字段订阅 store，而不是 `useUiStore()` 整店订阅——整店订阅会让任何一处
 * 状态变化（比如详情栏折叠）都重渲染这一行。
 */
export function Toolbar({
  total,
  onCheckUpdates,
  onScan,
}: {
  total: number
  onCheckUpdates: () => void
  onScan: () => void
}) {
  const filters = useUiStore((s) => s.filters)
  const setQuery = useUiStore((s) => s.setQuery)
  const clearFilters = useUiStore((s) => s.clearFilters)
  const openCreate = useUiStore((s) => s.openCreate)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-2">
      {/* 搜索框是这一行里唯一允许被压缩的东西，别的都不行：
          按钮一旦被压到文字竖排（「扫/描」两行），就成了整屏最难看的那个点。
          给它一个下限，窄下去时先丢的是搜索框的宽度。 */}
      <div className="w-56 min-w-32">
        <Input
          id="project-search"
          value={filters.q}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按名称、路径、远程地址搜"
          aria-label="搜索项目"
        />
      </div>
      {hasFilter(filters) ? (
        <Button className="shrink-0" onClick={clearFilters}>
          <Eraser size={14} aria-hidden />
          清掉筛选
        </Button>
      ) : null}
      <span className="shrink-0 font-mono text-[12px] text-ink-3">
        {total} 个项目
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* 「联网」两个字是必须的：详情页还有一个只读本地的按钮，
            两个都叫「检查更新」的话，用户没法从名字看出哪个会联网。
            这里**不再有「检查中…」态**：进度和报告都在随后打开的弹窗里，
            按钮照旧的写法（`checking={panelOpen}`）会在检查早已跑完、弹窗还开着时
            继续显示「检查中…」——那是在骗人。 */}
        <Button
          onClick={onCheckUpdates}
          title="联网 fetch 远程，看每个仓库落后多少、推不推荐更新"
        >
          <RefreshCw size={14} aria-hidden />
          联网检查更新
        </Button>
        <Button onClick={onScan} title="去设置里扫描一个目录，把本机仓库批量加进清单">
          <FolderSearch size={14} aria-hidden />
          扫描目录
        </Button>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={14} aria-hidden />
          添加项目
        </Button>
      </div>
    </div>
  )
}

/**
 * 分组下拉里「全部」的取值。**不能用空串**——空串是「未分类」这个合法筛选值，
 * 两个选项撞值的话，选了「未分类」下拉会显示成「全部」而筛的是空串：
 * 控件说的和它做的不一致。
 */
const ALL_GROUPS = '__all__'

/**
 * 列表头那一行：看全局的三件事——状态 / 分组 / 排序，外加快捷键提示。
 *
 * 「分组」那个下拉里的「未分类」是**空串**，而「全部」需要另一个值：
 * 两个选项共用空串时，选了「未分类」下拉会显示成「全部」，筛的却是空串。
 */
export function ListHeader() {
  const filters = useUiStore((s) => s.filters)
  const setAttention = useUiStore((s) => s.setAttention)
  const setCategory = useUiStore((s) => s.setCategory)
  const setSort = useUiStore((s) => s.setSort)

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-1.5">
      <Sel
        label="状态"
        value={filters.attention ?? ''}
        onChange={(v) => setAttention(v === '' ? null : (v as Attention))}
      >
        <option value="">全部</option>
        <option value="ready">可更新</option>
        <option value="synced">已同步</option>
        <option value="blocked">不推荐</option>
        <option value="decide">需要确认</option>
        <option value="unchecked">待检查</option>
      </Sel>

      <Sel
        label="分组"
        value={filters.category ?? ALL_GROUPS}
        onChange={(v) => setCategory(v === ALL_GROUPS ? null : v)}
      >
        <option value={ALL_GROUPS}>全部</option>
        <option value="">未分类</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {categoryLabel(c)}
          </option>
        ))}
      </Sel>

      {/*
        「默认」是一项，不是一个 sort 值：服务端的默认序是「先按分类分组、同类
        再按名称」，而下面的「按名称」是**纯名称序**。让空值冒充「按名称」的话，
        下拉说的和实际排出来的不一样。
      */}
      <Sel
        label="排序"
        value={filters.sort ?? ''}
        onChange={(v) => setSort(v === '' ? null : (v as ProjectSort))}
      >
        <option value="">默认（按分类）</option>
        <option value="name">按名称</option>
        <option value="checked">按上次检查</option>
        <option value="behind">按落后数</option>
      </Sel>

      {/*
        全局快捷键的提示。**它们本来有一行专门显示这个**（在状态栏里），
        那一行删掉以后，五个还能按的键就成了「有但没人知道」。

        只显示组合键、说明挂在 title 上，与原来那一行同一套做法。

        `refresh-local`（F5）不在这里：它由详情页注册，清单页没打开详情时按了没用。
      */}
      <span className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[11px] text-ink-3">
        {GLOBAL_COMMANDS.filter((c) => c.id !== 'refresh-local').map((c) => (
          <span key={c.id} title={c.label}>
            {c.combo}
          </span>
        ))}
      </span>
    </div>
  )
}

/** 列表头上的下拉。用 `<label>` 包住，读屏拿到的是标签文字而不是没有名字的控件。 */
function Sel({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-3">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-[3px] border border-line bg-panel px-2 text-[12.5px] text-ink focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </label>
  )
}
