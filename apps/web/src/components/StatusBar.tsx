import { X } from 'lucide-react'
import { useSelectedCount, useUiStore } from '@/store/ui'

/**
 * 状态栏。
 *
 * 原来是清单页底部一个 `fixed inset-x-0 bottom-0` 的浮层——那是被选中时才出现的
 * 网页套路。桌面软件把「选中了几个 / 能做什么」放在常驻状态栏里：它不盖内容、
 * 不在出现与消失之间推动布局，而且「已选 0 个」时它就该在那儿说明当前状态。
 *
 * 高度 28px，与标题栏的 36px 一起构成窗口的上下两条边。
 */
export function StatusBar() {
  const selectedCount = useSelectedCount()
  const clearSelection = useUiStore((s) => s.clearSelection)

  return (
    <footer className="chrome flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[12px]">
      {selectedCount > 0 ? (
        <>
          <span className="font-mono text-ink-2">已选 {selectedCount} 个项目</span>
          <button
            onClick={clearSelection}
            className="inline-flex cursor-pointer items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-ink-2 hover:bg-paper hover:text-ink"
          >
            <X size={12} aria-hidden />
            取消选择
          </button>
          <span className="text-ink-3">勾选后点「联网检查更新」，只会检查这几个</span>
        </>
      ) : null}
    </footer>
  )
}
