import { Eraser, FolderSearch, Plus, RefreshCw, Settings } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { hasFilter, useUiStore } from '@/store/ui'
import { FilterToggle } from './FilterToggle'

/**
 * 清单页的控件行：搜索 / 计数 / 四个动作。
 *
 * **这里原来还有第二行**（状态 / 分组 / 排序 三个下拉）。它被删掉了，因为那三件事
 * 各自都有更好的入口：
 *
 * - **状态、分组** → 左栏的过滤面板（那边带计数、点一下筛、再点一下取消）；
 * - **排序** → **表头**（点一下按那一列排、再点翻方向、第三下复位回默认序）。
 *
 * 最后一条是删掉那一行的前提：在表头支持「复位」之前，排序下拉是**唯一**能回到
 * 「默认（按分类）」的入口，所以那一行只能留着。表头三态循环落地之后，它才真的
 * 只是同一件事的第二个入口。
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
  const openSettings = useUiStore((s) => s.openSettings)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-2">
      {/*
        收起/展开过滤面板。**放在搜索框左边第一个**：它是这一行里唯一"改变布局"
        的控件（其余都是动作），贴在最左边与它折叠的那一列相邻，位置对得上。
        它自己不订阅任何东西——状态在 `FilterToggle` 里，这里只负责摆进去。
      */}
      <FilterToggle />
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
      <span className="shrink-0 font-mono text-[12px] text-ink-3">{total} 个项目</span>
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
        <Button onClick={openSettings} title="设置：扫描目录、标签、联网检查与更新的参数">
          <Settings size={14} aria-hidden />
          设置
        </Button>
      </div>
    </div>
  )
}
