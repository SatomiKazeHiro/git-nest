import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { groupBy, orderBy } from 'es-toolkit'
import { useDebounce } from 'ahooks'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { Button, Dialog, EmptyState, ErrorNote, Input } from '@/components/ui'
import { formatDate, formatRelative, hostOf, shortenPath } from '@/lib/format'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'
import { ProjectFormDialog } from './ProjectFormDialog'
import { useProjects, useRemoveProject } from './queries'
import { StatusCell } from '@/features/status/StatusCell'
import { useStatuses } from '@/features/status/queries'
import { UpdatePanel } from '@/features/updates/UpdatePanel'

export function ProjectsPage() {
  const navigate = useNavigate()
  const filters = useUiStore((s) => s.filters)
  const setCategory = useUiStore((s) => s.setCategory)
  const selected = useUiStore((s) => s.selected)
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
              ids={selected.size > 0 ? [...selected] : (projects ?? []).map((p) => p.id)}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        ) : null}
        {isPending ? (
          <p className="py-10 font-mono text-[13px] text-ink-3">正在读清单…</p>
        ) : !projects || projects.length === 0 ? (
          <EmptyList filtering={Boolean(filters.category || filters.tag || filters.q)} />
        ) : (
          <ul className="flex flex-col gap-5 pt-1">
            <ColumnHeader />
            {groups.map((group) => (
              <li key={group.name} className="branch">
                <GroupHeader
                  name={group.name}
                  count={group.items.length}
                  active={group.filterable && filters.category === group.name}
                  onFilter={group.filterable ? () => setCategory(group.name) : undefined}
                />
                <ul className="pl-6">
                  {group.items.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      status={statuses?.get(p.id)}
                      onRemove={() => setPendingRemoval(p)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
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

function ColumnHeader() {
  return (
    <li className="flex items-center gap-3 border-b border-line pb-1.5 text-[11px] text-ink-3">
      <span className="w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 sm:w-40 sm:flex-none">名称</span>
      <span className="hidden w-52 shrink-0 font-mono lg:block">本地路径</span>
      <span className="hidden min-w-32 flex-1 sm:block">摘要</span>
      <span className="hidden w-24 shrink-0 font-mono 2xl:block">远程</span>
      <span className="hidden w-48 shrink-0 md:block">状态</span>
      <span className="w-20 shrink-0 sm:w-24">标签</span>
      <span className="hidden w-16 shrink-0 text-right sm:inline-block">备注</span>
      <span className="hidden w-20 shrink-0 text-right lg:inline-block">检查</span>
      <span className="hidden w-20 shrink-0 text-right md:inline-block">加入</span>
      <span className="w-16 shrink-0" />
    </li>
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
  const { filters, setQuery, clearFilters, openCreate } = useUiStore()
  const selectedCount = useUiStore((s) => s.selected.size)
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
      {filtering ? <Button onClick={clearFilters}>清掉筛选</Button> : null}
      <span className="font-mono text-[12px] text-ink-3">
        {total} 个项目
        {selectedCount > 0 ? ` · 已选 ${selectedCount}` : ''}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button onClick={onCheckUpdates} className={checking ? 'border-accent text-accent' : ''}>
          检查更新
        </Button>
        <Button onClick={onScan} title="去设置里扫描一个目录，把本机仓库批量加进清单">
          扫描目录
        </Button>
        <Button variant="primary" onClick={openCreate}>
          添加项目
        </Button>
      </div>
    </div>
  )
}

function SelectionBar() {
  const selected = useUiStore((s) => s.selected)
  const clearSelection = useUiStore((s) => s.clearSelection)
  if (selected.size === 0) return null
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-line bg-panel/95 px-6 py-2.5 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[13px] text-ink-2">已选 {selected.size} 个项目</span>
        <Button onClick={clearSelection}>取消选择</Button>
        <span className="text-[12px] text-ink-3">
          勾选后点「检查更新」，只会检查这几个
        </span>
      </div>
    </div>
  )
}

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
    <div className="relative mb-1.5 pl-5">
      <span className="branch-node" />
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
      <span className="ml-2 font-mono text-[12px] text-ink-3">{count}</span>
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
  const host = hostOf(p.remoteUrl)
  // 目录没了：置灰但保留入口，让用户能改路径或移除——不自动消失
  const gone = status?.status === 'missing'

  return (
    <li
      className={`row-link group flex items-center gap-3 py-1.5 pr-2 ${gone ? 'opacity-50' : ''}`}
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
        className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink hover:text-accent sm:w-40 sm:flex-none"
      >
        {p.name}
      </Link>
      <span className="hidden w-52 shrink-0 truncate font-mono text-[12px] text-ink-3 lg:block">
        {shortenPath(p.path, 2)}
      </span>
      <span className="hidden min-w-32 flex-1 truncate text-[12.5px] text-ink-2 sm:block">
        {p.summary ?? ''}
      </span>
      <span className="hidden w-24 shrink-0 truncate font-mono text-[12px] text-ink-3 2xl:block">
        {host ?? ''}
      </span>
      <span className="hidden w-48 shrink-0 md:block">
        <StatusCell status={status} checkedAt={p.latestCheck?.checkedAt ?? null} />
      </span>
      <span className="w-20 shrink-0 flex-wrap gap-1 sm:w-24">
        {p.tags.map((t) => (
          <span
            key={t.id}
            className="rounded-[2px] border border-line px-1 font-mono text-[11px] text-ink-2"
          >
            {t.name}
          </span>
        ))}
      </span>
      <span className="hidden w-16 shrink-0 text-right font-mono text-[12px] text-ink-3 sm:block">
        {p.notesCount > 0 ? `${p.notesCount} 条` : ''}
      </span>
      <span
        className="hidden w-20 shrink-0 text-right font-mono text-[12px] text-ink-3 lg:block"
        title={p.latestCheck ? `上次检查：${p.latestCheck.status}` : '还没检查过更新'}
      >
        {p.latestCheck ? formatRelative(p.latestCheck.checkedAt) : '—'}
      </span>
      <span className="hidden w-20 shrink-0 text-right font-mono text-[12px] text-ink-3 md:block">
        {formatDate(p.addedAt)}
      </span>
      <span className="flex w-16 shrink-0 justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={() => openEdit(p.id)}
          className="rounded-[3px] px-1.5 py-0.5 text-[12px] text-ink-2 hover:bg-panel hover:text-ink"
        >
          编辑
        </button>
        <button
          onClick={onRemove}
          className="rounded-[3px] px-1.5 py-0.5 text-[12px] text-ink-2 hover:bg-panel hover:text-signal-bad"
        >
          移除
        </button>
      </span>
    </li>
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
          移出清单
        </Button>
      </div>
    </Dialog>
  )
}
