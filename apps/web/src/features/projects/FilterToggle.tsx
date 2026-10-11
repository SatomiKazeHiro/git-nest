import { ChevronLeft, ChevronRight } from 'lucide-react'
import { hasFilter, useUiStore } from '@/store/ui'

/**
 * 过滤面板的收起开关：面板右缘外的一枚**半胶囊**。
 *
 * 它长在留出来的那条 20px 槽里（见 `index.css` 的 `.split`），**不浮在表格上**：
 * 表格左边缘就是「仓库」那一列（logo + 名字），浮上去必然在某些滚动位置压住它。
 * 这个软件一路的取舍都是不为了好看去压内容。
 *
 * 收起之后**它自己还在**——否则面板关上了就再也打不开。方向由 chevron 与
 * `aria-expanded` 一起表达：chevron 指的方向 = 点下去面板会往哪边走。
 */
export function FilterToggle() {
  const open = useUiStore((s) => s.filterPanelOpen)
  const toggle = useUiStore((s) => s.toggleFilterPanel)
  /*
    面板一收起，那几段高亮就全看不见了，这枚圆点是「表里现在不是全部」的
    唯一可见线索。展开着的时候不需要它——高亮本身就在眼前。
  */
  const filtered = useUiStore((s) => hasFilter(s.filters))

  const label = open ? '收起过滤面板' : '展开过滤面板'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      title={filtered ? `${label}（当前有筛选）` : label}
      className="filter-toggle"
    >
      {open ? <ChevronLeft size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
      {filtered ? <span className="filter-toggle-dot" aria-hidden /> : null}
      {/* 只放图标，所以名字写在这里（`title` 只是补充，不作名字） */}
      <span className="sr-only">{label}</span>
    </button>
  )
}
