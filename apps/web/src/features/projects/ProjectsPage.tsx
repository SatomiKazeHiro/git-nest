import { Fragment, useMemo, useState } from 'react'
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
  const setCategory = useUiStore((s) => s.setCategory)
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
            一整张表，**不是每个分区一张**。
            原来是 groups.map 里各塞一个 `<ul>` + 各印一份 ColumnHeader，
            于是分区一多就是好几张表上下叠着；而且每行用 flex + 固定宽度对齐，
            跨分区的列根本对不齐。
            现在表头只印一次，分组是表里的一行分隔（占满整行），
            所有行共用同一套 grid 列定义（`LIST_COLUMNS`），列必然对齐。
          */
          <div className="list-grid pt-1">
            <ColumnHeader />
            {groups.map((group) => (
              <Fragment key={group.name}>
                <GroupHeader
                  name={group.name}
                  count={group.items.length}
                  active={group.filterable && filters.category === group.name}
                  onFilter={group.filterable ? () => setCategory(group.name) : undefined}
                />
                {group.items.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    status={statuses?.get(p.id)}
                    onRemove={() => setPendingRemoval(p)}
                  />
                ))}
              </Fragment>
            ))}
          </div>
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
 * 表头。只印一次，粘在工具栏下面。
 *
 * **每个格子都带 `.col-*`（列宽），和下面的行写的是同一套类**——
 * 所以表头与行的列宽在任何断点都一致。这正是上一版错位的根因：
 * 表头用 `lg:block`、行里用 `sm:block`，两边对不上，列必然错开。
 *
 * 列定义本身（`.list-grid` 与那套 `.col-*`）在 `index.css` 里，用普通 CSS 写的。
 * 曾经把它写成 JS 拼串的 `grid-cols-[...]`，Tailwind v4 扫不到完整字面量，
 * 那条规则没生成，整张表退化成单列竖着排。
 */
function ColumnHeader() {
  return (
    <div className="sticky top-[3.25rem] z-[5] border-b border-line bg-paper/95 py-1.5 text-[11px] text-ink-3 backdrop-blur">
      <span />
      <span>名称</span>
      <span className="col-summary">摘要</span>
      <span className="col-path font-mono">本地路径</span>
      <span>标签</span>
      {/* 这一列只回答「跟远程差多少」——不显示分支名，也不显示脏标记 */}
      <span className="col-behind">落后</span>
      <span className="col-author text-right">作者更新</span>
      <span className="col-recommend">推荐</span>
      <span className="col-checked text-right">上次检查</span>
      <span className="col-notes text-right">备注</span>
      <span />
    </div>
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

/**
 * 分区标题——**它是表里的一行，不是一张新表**。
 *
 * 原来每个分区有一份自己的表头，于是多分区就成了「好几张表叠着」。
 * 现在它是一个占满整行（`col-span-full`）的分隔条，分组名落在「名称」那一列上，
 * 与下面的项目名左对齐。
 *
 * 那个 `branch-node` 小圆点去掉了：它画在 `pl-5` 的位置，与名称列的起点对不齐，
 * 在单表布局里就是纯粹的错位。
 */
function GroupHeader({
  name,
  count,
  active,
  onFilter,
}: {
  name: string
  count: number
  active: boolean
  onFilter?: () => void
}) {
  return (
    <div className="col-span-full mt-4 flex items-baseline gap-2 border-b border-line-soft pb-1">
      {/* 空一格给选择框，让分组名与项目名对齐 */}
      <span className="w-3.5 shrink-0" />
      {onFilter ? (
        <button
          onClick={onFilter}
          className={`font-mono text-[12px] tracking-wide hover:underline ${
            active ? 'text-accent underline' : 'text-ink-2'
          }`}
        >
          {name}
        </button>
      ) : (
        <span className="font-mono text-[12px] tracking-wide text-ink-3">{name}</span>
      )}
      <span className="font-mono text-[12px] text-ink-3">{count}</span>
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
    <div
      className={`list-grid row-link group py-1.5 ${gone ? 'opacity-50' : ''}`}
      title={gone ? '目录不在了。点「编辑」可以把它指到新位置。' : undefined}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggleSelected(p.id)}
        aria-label={`选择 ${p.name}`}
        className="size-3.5 shrink-0 accent-[#14506e]"
      />
      <Link
        to={`/projects/${p.id}`}
        className="min-w-0 truncate text-[13.5px] font-medium text-ink hover:text-accent"
      >
        {p.name}
      </Link>
      <span className="col-summary min-w-0 truncate text-[12.5px] text-ink-2">
        {p.summary ?? ''}
      </span>
      <span className="col-path min-w-0 truncate font-mono text-[12px] text-ink-3">
        {shortenPath(p.path, 2)}
      </span>
      <span className="flex min-w-0 flex-wrap gap-1 overflow-hidden">
        {p.tags.map((t) => (
          <span
            key={t.id}
            className="rounded-[2px] border border-line px-1 font-mono text-[11px] text-ink-2"
          >
            {t.name}
          </span>
        ))}
      </span>
      <span className="col-behind min-w-0">
        <StatusCell status={status} checkedAt={p.latestCheck?.checkedAt ?? null} />
      </span>
      {/* 作者上次更新：远程最后一次提交的时间。用户明确要看这一条 */}
      <span
        className="col-author min-w-0 truncate text-right font-mono text-[12px] text-ink-3"
        title={status?.lastCommit ? status.lastCommit.subject : undefined}
      >
        {status?.lastCommit ? formatRelative(status.lastCommit.date) : ''}
      </span>
      {/* 推荐更新：用户点名要的那一列。结论来自上次检查（见 RecommendationCell 的注释） */}
      <span className="col-recommend min-w-0">
        <RecommendationCell recommendation={p.latestCheck?.recommendation ?? null} />
      </span>
      <span
        className="col-checked flex min-w-0 justify-end"
        title={p.latestCheck ? `上次检查：${p.latestCheck.status}` : '还没点过「检查更新」'}
      >
        {p.latestCheck ? (
          <Meta label="检查" value={formatRelative(p.latestCheck.checkedAt)} />
        ) : (
          <Meta label="检查" value="没查过" placeholder />
        )}
      </span>
      <span className="col-notes min-w-0 truncate text-right font-mono text-[12px] text-ink-3">
        {p.notesCount > 0 ? `${p.notesCount} 条` : ''}
      </span>
      <span className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={() => openEdit(p.id)}
          title="编辑"
          aria-label={`编辑 ${p.name}`}
          className="rounded-[3px] p-1 text-ink-2 hover:bg-panel hover:text-ink"
        >
          <Pencil size={13} aria-hidden />
        </button>
        <button
          onClick={onRemove}
          title="移出清单"
          aria-label={`移出清单 ${p.name}`}
          className="rounded-[3px] p-1 text-ink-2 hover:bg-panel hover:text-signal-bad"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </span>
    </div>
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
