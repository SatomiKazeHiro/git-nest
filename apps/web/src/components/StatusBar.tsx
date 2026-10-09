import { X } from 'lucide-react'
import { ROW_COMMANDS } from '@/lib/keys'
import { formatRelative } from '@/lib/format'
import { useProjects } from '@/features/projects/queries'
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
  // 「上次检查」是**全应用**的一条事实（最后一次问到远程是什么时候），
  // 所以它跟着整份清单走，不跟着当前筛选走——筛完只剩一个老仓库时，
  // 状态栏不该改口说「刚刚查过」。
  const { data: projects } = useProjects({})

  /*
    取最新的那次，**不是第一个项目的**：清单是按分类分组的，第一个项目完全可能
    是三个月前查的。ISO 串按字典序比就是时间序，不必 new Date。
  */
  const lastCheckedAt = (projects ?? []).reduce<string | null>(
    (acc, p) => {
      const t = p.latestCheck?.checkedAt
      return t && (acc === null || t > acc) ? t : acc
    },
    null,
  )

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

      {/*
        没查过时**说「还没检查过」而不是留空或写「—」**：清单刚导入时全部项目
        都没查过是很正常的状态，一个残缺的占位符会被读成「读不出来」。
      */}
      <span
        className="ml-auto shrink-0 font-mono text-[11px] text-ink-3"
        title="清单里最近一次联网 fetch 远程的时间"
      >
        上次检查 {lastCheckedAt ? formatRelative(lastCheckedAt) : '还没检查过'}
      </span>

      {/*
        行内按键的提示。没有它这些键等于不存在——桌面软件不会弹「你可以试试
        按空格」的气泡，而行内那几条（↑↓ / Space / Enter / Delete）**不带
        修饰键**，用户根本猜不到它们属于这个列表。
        文案直接读 `ROW_COMMANDS`，跟真正处理它们的那张表同源。
      */}
      <span className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-ink-3">
        {ROW_COMMANDS.map((c) => (
          <span key={c.combo} title={c.label}>
            {c.combo}
          </span>
        ))}
      </span>
    </footer>
  )
}
