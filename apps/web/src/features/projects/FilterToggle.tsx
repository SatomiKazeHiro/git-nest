import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui'
import { hasFilter, useUiStore } from '@/store/ui'

/**
 * 过滤面板的收起开关：**工具条里的一枚图标按钮**（搜索框左边第一个）。
 *
 * 它原来是一枚浮在表格左沿的半胶囊——那个位置压着表格约 20px（logo 的左沿），
 * 而且为了不压内容还得给它留一条槽，两列于是变成三列、中间空一条。挪进工具条之后
 * 那两样代价一起没了：工具条本来就是 chrome 的地盘。
 *
 * **只换了位置与形状，状态逻辑与无障碍语义一个字没改**：`aria-expanded`、
 * 可访问名字仍是「收起过滤面板 / 展开过滤面板」（图标按钮靠 `sr-only` 给名字）、
 * `title` 里那句「（当前有筛选）」也留着。
 *
 * 收起之后它自己还在（在工具条里，谁也动不了它）——否则抽屉关了就再也打不开。
 * 图标用 `PanelLeftClose` / `PanelLeftOpen` 这一对：**收起时显示"能展开"的那个方向**。
 */
export function FilterToggle() {
  const open = useUiStore((s) => s.filterPanelOpen)
  const toggle = useUiStore((s) => s.toggleFilterPanel)
  /*
    有筛选时的那枚小圆点。以前它只在面板收起后才有意义（那几段高亮全看不见了），
    现在它常驻在按钮角上——**一眼就知道"表里不是全部"**，不必先收起面板才发现。
  */
  const filtered = useUiStore((s) => hasFilter(s.filters))

  const label = open ? '收起过滤面板' : '展开过滤面板'
  return (
    <Button
      onClick={toggle}
      aria-expanded={open}
      title={filtered ? `${label}（当前有筛选）` : label}
      /* relative：那枚角标要绝对定位在它右上角 */
      className="relative shrink-0"
    >
      {/* 图标是「点下去会发生什么」：收起时给的是"能展开"那个方向 */}
      {open ? <PanelLeftClose size={14} aria-hidden /> : <PanelLeftOpen size={14} aria-hidden />}
      {/* 只放图标，所以名字写在这里（`title` 只是补充，不作名字） */}
      <span className="sr-only">{label}</span>
      {filtered ? <span className="filter-toggle-dot" aria-hidden /> : null}
    </Button>
  )
}
