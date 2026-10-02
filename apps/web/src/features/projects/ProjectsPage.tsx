import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { groupBy, orderBy } from 'es-toolkit'
import { useDebounce } from 'ahooks'
import { Eraser, FolderSearch, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { Button, Dialog, EmptyState, ErrorNote, Input, Meta } from '@/components/ui'
import { formatRelative, shortenPath } from '@/lib/format'
import { UNCATEGORIZED, useSelectedCount, useSelectedIds, useUiStore } from '@/store/ui'
import { ProjectFormDialog } from './ProjectFormDialog'
import { useProjects, useRemoveProject } from './queries'
import { RecommendationCell, StatusCell } from '@/features/status/StatusCell'
import { useStatuses } from '@/features/status/queries'
import { UpdatePanel } from '@/features/updates/UpdatePanel'

export function ProjectsPage() {
  const navigate = useNavigate()
  const filters = useUiStore((s) => s.filters)
  // 用内容稳定的 id 列表，而不是 `s.selected` 那个每次都换引用的 Set
  const selectedIds = useSelectedIds()
  const [pendingRemoval, setPendingRemoval] = useState<ProjectListItem | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const debouncedQuery = useDebounce(filters.q, { wait: 200 })
  const { data: projects, isPending, error } = useProjects({
    category: filters.category,
    tag: filters.tag,
    q: debouncedQuery,
  })

  const { data: statuses } = useStatuses((projects ?? []).map((p) => p.id))

  /**
   * 行按分类排序——**但分类只是排序依据，不是表里的结构**。
   *
   * 表里没有分区行：分类是侧栏的事（点一下筛那一类）。
   * 这里保留分组只是因为「同类连在一起」好读，同类之间按名称排。
   */
  const groups = useMemo(() => {
    const byCategory = groupBy(projects ?? [], (p) => p.category || UNCATEGORIZED)
    return orderBy(
      Object.entries(byCategory),
      [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => name.toLowerCase()],
      ['asc', 'asc'],
    ).map(([name, items]) => ({ name, items, filterable: name !== UNCATEGORIZED }))
  }, [projects])

  if (error) {
    return (
      <div className="p-6">
        <ErrorNote message="读不到项目清单。后端可能没启动——在仓库根目录跑 pnpm dev，再刷新这个页面。" />
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <Toolbar
        total={projects?.length ?? 0}
        onCheckUpdates={() => setPanelOpen(true)}
        onScan={() => navigate('/settings#scan')}
        checking={panelOpen}
      />

      <div className="flex-1 px-6 pb-24">
        {panelOpen ? (
          <div className="pt-4">
            <UpdatePanel
              ids={selectedIds.length > 0 ? selectedIds : (projects ?? []).map((p) => p.id)}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        ) : null}
        {isPending ? (
          <p className="py-10 font-mono text-[13px] text-ink-3">正在读清单…</p>
        ) : !projects || projects.length === 0 ? (
          <EmptyList filtering={Boolean(filters.category || filters.tag || filters.q)} />
        ) : (
          /*
            一张平表：**一个表头 + 平铺的行**。

            这里踩过两个坑，都是「把分组塞进表里」造成的：
            1. 最早是每个分区一个 `<ul>` + 各印一份表头 → 好几张表叠着。
            2. 后来改成一张表，却把分区渲染成一整行分隔条（`colSpan` 的 `<tr>`）
               → 换汤不换药，看着还是「一坨分区叠着一坨」。

            现在表里**完全没有分区这回事**：分类是侧栏的事（点一下就筛那一类），
            在表里再来一层就是重复。行按分类排序，同类自然连在一起。
          */
          <table className="list-table pt-1">
            <ColumnHeader />
            <tbody>
              {groups.flatMap((group) =>
                group.items.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    status={statuses?.get(p.id)}
                    onRemove={() => setPendingRemoval(p)}
                  />
                )),
              )}
            </tbody>
          </table>
        )}
      </div>

      <SelectionBar />
      {pendingRemoval ? (
        <RemoveDialog project={pendingRemoval} onClose={() => setPendingRemoval(null)} />
      ) : null}
      <ProjectFormDialog />
    </div>
  )
}

function EmptyList({ filtering }: { filtering: boolean }) {
  const openCreate = useUiStore((s) => s.openCreate)
  const clearFilters = useUiStore((s) => s.clearFilters)
  return filtering ? (
    <EmptyState
      title="没有匹配的项目"
      body="换个关键字，或把筛选条件清掉再看一眼。"
      action={<Button onClick={clearFilters}>清掉筛选</Button>}
    />
  ) : (
    <EmptyState
      title="清单还是空的"
      body="先把已经在本机的仓库加进来：一个项目一条记录，之后就能在这里统一看着它们。路径填本地目录，例如 D:/Git/canvas-editor。"
      action={
        <Button variant="primary" onClick={openCreate}>
          添加第一个项目
        </Button>
      }
    />
  )
}

/**
 * 表头。只印一次（`<thead>` 里的唯一一行），粘在工具栏下面。
 *
 * 列宽全在 `.col-*` 上（`index.css`），**数据行用的是同一套类**——
 * 但真正保证对齐的是 `table-fixed`：浏览器按第一行的列宽统一分配，
 * 表头与数据行不需要「手工保持一致」。
 */
function ColumnHeader() {
  return (
    <thead className="tr-tint sticky top-[3.25rem] z-[5]">
      <tr className="border-b border-line text-[11px] text-ink-3">
        <th className="col-check" />
        <th className="col-name">名称</th>
        <th className="col-summary">摘要</th>
        <th className="col-path font-mono">本地路径</th>
        <th className="col-tags">标签</th>
        {/* 这一列只回答「跟远程差多少」——不显示分支名，也不显示脏标记 */}
        <th className="col-behind">落后</th>
        <th className="col-author text-right">作者更新</th>
        <th className="col-recommend">推荐</th>
        <th className="col-checked text-right">上次检查</th>
        <th className="col-notes text-right">备注</th>
        <th className="col-actions" />
      </tr>
    </thead>
  )
}

function Toolbar({
  total,
  onCheckUpdates,
  onScan,
  checking,
}: {
  total: number
  onCheckUpdates: () => void
  onScan: () => void
  checking: boolean
}) {
  // 逐个字段订阅，而不是 `useUiStore()` 整店订阅 ——
  // 整店订阅会让「勾选任何一行」都重渲染整个顶栏（搜索框、三个按钮、计数）。
  const filters = useUiStore((s) => s.filters)
  const setQuery = useUiStore((s) => s.setQuery)
  const clearFilters = useUiStore((s) => s.clearFilters)
  const openCreate = useUiStore((s) => s.openCreate)
  const selectedCount = useSelectedCount()
  const filtering = Boolean(filters.category || filters.tag || filters.q)

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-paper/95 px-6 py-3 backdrop-blur">
      <div className="w-64">
        <Input
          value={filters.q}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按名称、路径、远程地址搜"
          aria-label="搜索项目"
        />
      </div>
      {filtering ? (
        <Button onClick={clearFilters}>
          <Eraser size={14} aria-hidden />
          清掉筛选
        </Button>
      ) : null}
      <span className="font-mono text-[12px] text-ink-3">
        {total} 个项目
        {selectedCount > 0 ? ` · 已选 ${selectedCount}` : ''}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button onClick={onCheckUpdates} className={checking ? 'border-accent text-accent' : ''}>
          <RefreshCw size={14} aria-hidden className={checking ? 'animate-spin' : ''} />
          {checking ? '检查中…' : '检查更新'}
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

function SelectionBar() {
  const selectedIds = useSelectedIds()
  const clearSelection = useUiStore((s) => s.clearSelection)
  if (selectedIds.length === 0) return null
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-line bg-panel/95 px-6 py-2.5 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[13px] text-ink-2">已选 {selectedIds.length} 个项目</span>
        <Button onClick={clearSelection}>
          <X size={14} aria-hidden />
          取消选择
        </Button>
        <span className="text-[12px] text-ink-3">
          勾选后点「检查更新」，只会检查这几个
        </span>
      </div>
    </div>
  )
}

function ProjectRow({
  project: p,
  status,
  onRemove,
}: {
  project: ProjectListItem
  status: RepoStatus | undefined
  onRemove: () => void
}) {
  const selected = useUiStore((s) => s.selected.has(p.id))
  const toggleSelected = useUiStore((s) => s.toggleSelected)
  const openEdit = useUiStore((s) => s.openEdit)
  // 目录没了：置灰但保留入口，让用户能改路径或移除——不自动消失
  const gone = status?.status === 'missing'

  return (
    <tr
      className={`row-link ${gone ? 'opacity-50' : ''}`}
      title={gone ? '目录不在了。点「编辑」可以把它指到新位置。' : undefined}
    >
      <td className="col-check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleSelected(p.id)}
          aria-label={`选择 ${p.name}`}
          className="size-3.5 accent-[#14506e]"
        />
      </td>
      <td className="col-name">
        <Link
          to={`/projects/${p.id}`}
          className="block truncate text-[13.5px] font-medium text-ink hover:text-accent"
        >
          {p.name}
        </Link>
      </td>
      <td className="col-summary truncate text-[12.5px] text-ink-2">{p.summary ?? ''}</td>
      <td className="col-path truncate font-mono text-[12px] text-ink-3">
        {shortenPath(p.path, 2)}
      </td>
      <td className="col-tags">
        <span className="flex flex-wrap gap-1 overflow-hidden">
          {p.tags.map((t) => (
            <span
              key={t.id}
              className="rounded-[2px] border border-line px-1 font-mono text-[11px] text-ink-2"
            >
              {t.name}
            </span>
          ))}
        </span>
      </td>
      <td className="col-behind">
        <StatusCell status={status} checkedAt={p.latestCheck?.checkedAt ?? null} />
      </td>
      {/* 作者上次更新：远程最后一次提交的时间。用户明确要看这一条 */}
      <td
        className="col-author truncate text-right font-mono text-[12px] text-ink-3"
        title={status?.lastCommit ? status.lastCommit.subject : undefined}
      >
        {status?.lastCommit ? formatRelative(status.lastCommit.date) : ''}
      </td>
      {/* 推荐更新：用户点名要的那一列。结论来自上次检查（见 RecommendationCell 的注释） */}
      <td className="col-recommend">
        <RecommendationCell recommendation={p.latestCheck?.recommendation ?? null} />
      </td>
      <td
        className="col-checked text-right"
        title={p.latestCheck ? `上次检查：${p.latestCheck.status}` : '还没点过「检查更新」'}
      >
        {p.latestCheck ? (
          <Meta label="检查" value={formatRelative(p.latestCheck.checkedAt)} />
        ) : (
          <Meta label="检查" value="没查过" placeholder />
        )}
      </td>
      <td className="col-notes truncate text-right font-mono text-[12px] text-ink-3">
        {p.notesCount > 0 ? `${p.notesCount} 条` : ''}
      </td>
      <td className="col-actions">
        <span className="row-actions flex justify-end gap-1">
          <button
            onClick={() => openEdit(p.id)}
            title="编辑"
            aria-label={`编辑 ${p.name}`}
            className="rounded-[3px] p-1 text-ink-2 hover:bg-paper hover:text-ink"
          >
            <Pencil size={13} aria-hidden />
          </button>
          <button
            onClick={onRemove}
            title="移出清单"
            aria-label={`移出清单 ${p.name}`}
            className="rounded-[3px] p-1 text-ink-2 hover:bg-paper hover:text-signal-bad"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </span>
      </td>
    </tr>
  )
}

function RemoveDialog({ project, onClose }: { project: ProjectListItem; onClose: () => void }) {
  const remove = useRemoveProject()

  return (
    <Dialog title={`把 ${project.name} 移出清单？`} onClose={onClose}>
      <p className="text-[13px] text-ink-2">
        只删掉这一条记录。磁盘上的 <span className="font-mono text-[12px]">{project.path}</span>{' '}
        和它的 git 历史都不动，备注和标签关联会一起清掉。
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>留下</Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate(project.id, { onSuccess: onClose, onError: onClose })}
        >
          <Trash2 size={14} aria-hidden />
          移出清单
        </Button>
      </div>
    </Dialog>
  )
}
