import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Eraser, FolderPlus, FolderSearch, RefreshCw, Settings } from 'lucide-react'
import { ApiError, api } from '@/lib/api'
import { useInvalidate } from '@/lib/invalidate'
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
  onScan,
  selection,
}: {
  total: number
  onScan: () => void
  /** 勾选之后的动作组；没有勾选就传 null（那一组整块不出现） */
  selection?: {
    count: number
    busy: boolean
    done: number
    total: number
    summary: Record<string, number> | null
    onRun: () => void
    onClear: () => void
  } | null
}) {
  const filters = useUiStore((s) => s.filters)
  const setQuery = useUiStore((s) => s.setQuery)
  const clearFilters = useUiStore((s) => s.clearFilters)
  const openCreate = useUiStore((s) => s.openCreate)
  const openSettings = useUiStore((s) => s.openSettings)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-2">
      <FilterToggle />

      {/*
        三个最常用的动作放在最左：添加 / 扫描 / 刷新——纯图标按钮，靠 title 说清
        各自干什么。刷新**只同步状态，不开弹窗**：这是最常用的一枚——看一眼就走。
      */}
      <Button variant="primary" onClick={openCreate} title="添加项目">
        <FolderPlus size={14} aria-hidden />
      </Button>
      <Button onClick={onScan} title="扫描目录，把本机仓库批量加进清单">
        <FolderSearch size={14} aria-hidden />
      </Button>
      <RefreshButton />

      {/*
        **勾选之后的动作组，放在这一行最左边**：勾选发生在表格里，动完就在上面，
        视线不用来回跳。它只在有勾选时出现，所以平时这一行不会被撑宽。
        按钮与搜索框共用一套尺寸（都是 `h-7`）——高度不一致是工具条最容易看出来
        的毛病，而那套尺寸只有 `Button` 的 `md` 与 `Input` 一处定义。
      */}
      {selection && selection.count > 0 ? (
        <>
          <span className="shrink-0 font-mono text-[12px] text-ink-2">已选 {selection.count} 个</span>
          {selection.busy ? (
            <span className="shrink-0 font-mono text-[12px] text-ink-3">
              更新中 {selection.done}/{selection.total}…
            </span>
          ) : selection.summary ? (
            <span
              className={`shrink-0 text-[12px] ${
                (selection.summary.failed ?? 0) > 0 ? 'text-signal-bad' : 'text-ink-3'
              }`}
            >
              已更新 {selection.summary.updated ?? 0} 个
              {selection.summary.commits ? `，共 ${selection.summary.commits} 个提交` : ''}
              {selection.summary.failed ? `，失败 ${selection.summary.failed} 个` : ''}
            </span>
          ) : null}
          <Button className="shrink-0" onClick={selection.onClear}>
            清空勾选
          </Button>
          <Button className="shrink-0" variant="primary" onClick={selection.onRun} disabled={selection.busy}>
            {selection.busy ? '更新中…' : `更新选中的 ${selection.count} 个`}
          </Button>
        </>
      ) : null}

      {hasFilter(filters) ? (
        <Button className="shrink-0" onClick={clearFilters}>
          <Eraser size={14} aria-hidden />
          清掉筛选
        </Button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/*
          搜索框在**右侧**：左侧留给「勾选之后的动作」，而搜索是随时会用、
          用完就离开的控件，贴着动作那一组放，宽的搜索框也不会把动作挤到第二行。
        */}
        <span className="shrink-0 font-mono text-[12px] text-ink-3">{total} 个项目</span>
        <div className="w-56 min-w-32">
          <Input
            id="project-search"
            value={filters.q}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称、路径、远程地址搜"
            aria-label="搜索项目"
          />
        </div>
        <Button onClick={openSettings} title="设置：扫描目录、标签、联网检查与更新的参数">
          <Settings size={14} aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/**
 * 「刷新」：联网同步一遍状态，**不开弹窗**。
 *
 * 它调的是 `POST /api/auto-fetch` —— 和后台每 :00/:30 那一轮**同一个入口**，
 * 所以拿到的结论与屏幕上原本的数字来自同一条路径（`repo_state`）。
 *
 * 三件事必须做对：
 * - **进行中要看得出来**：15 个仓库大约几秒，没有反馈的话用户会连点三次；
 * - **结果要说出来**：成功几个、跳过几个（自己写的项目默认不联网）；
 * - **失败不许沉默**：`ApiError` 的 message 直接摆出来。刷新失败却显示「刷新好了」
 *   是最坏的一种反馈——排查时什么都看不到（这条在平台模块那边也写着）。
 */
function RefreshButton() {
  const invalidate = useInvalidate()
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useMutation({
    mutationFn: () =>
      api.post<{ summary: { checked: number; failed: number; skipped: number } }>(
        '/auto-fetch',
        {},
      ),
    onSuccess: ({ summary }) => {
      setError(null)
      const parts = [`已刷新 ${summary.checked} 个`]
      if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 个（自己的项目）`)
      if (summary.failed > 0) parts.push(`${summary.failed} 个失败`)
      setDone(parts.join('，'))
      // 状态列、检查时间、详情都跟着变
      invalidate()
    },
    onError: (e) => {
      setDone(null)
      setError(e instanceof ApiError ? e.message : '刷新失败')
    },
  })

  return (
    <>
      <Button
        className="shrink-0"
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        aria-label="刷新"
        title="联网 fetch 远程引用，重算每个仓库的状态。只动 refs/remotes/*，不碰工作区，也不会打开弹窗"
      >
        <RefreshCw size={14} aria-hidden className={refresh.isPending ? 'animate-spin' : ''} />
      </Button>
      {error ? (
        <span role="alert" className="shrink-0 text-[12px] text-signal-bad">
          {error}
        </span>
      ) : done ? (
        <span className="shrink-0 text-[12px] text-ink-3">{done}</span>
      ) : null}
    </>
  )
}