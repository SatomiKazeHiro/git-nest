import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { groupBy, orderBy } from 'es-toolkit'
import { useDebounce } from 'ahooks'
import {
  Eraser,
  FolderGit2,
  FolderSearch,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  CATEGORIES,
  categoryLabel,
  type Attention,
  type ProjectListItem,
  type ProjectSort,
  type RepoStatus,
} from '@git-nest/core'
import { Button, Dialog, EmptyState, ErrorNote, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { registerCommand } from '@/lib/commands'
import { formatRelative } from '@/lib/format'
import { UNCATEGORIZED, useSelectedCount, useSelectedIds, useUiStore, type Filters } from '@/store/ui'
import { useProjects, useRemoveProject } from './queries'
import { AttentionBadge, Diff, SyncBadge } from '@/features/status/StatusCell'
import { useStatuses } from '@/features/status/queries'
import { UpdatePanel } from '@/features/updates/UpdatePanel'

/**
 * 「现在有筛选吗」。
 *
 * **不能用真值判断**：`category === ''` 是一个合法的筛选值（「只看没分类的」）。
 * 真值判断会把它当成没筛选，于是两处同时失灵——工具条上的「清掉筛选」按钮
 * 不出现，空状态也不说「换个条件看看」，用户就被卡在这里了。
 *
 * 写成函数而不是在两处各抄一遍：这两处必须一致，抄开迟早只改一处。
 */
const hasFilter = (f: Filters) => Boolean(f.q || f.tag || f.own || f.attention) || f.category !== null

export function ProjectsPage() {
  const navigate = useNavigate()
  /*
    「右栏正在看谁」住在 URL 里（`/projects/:id`），不是 store。
    理由是它和「勾选了哪些」是两件不同的事：勾选决定批量动作作用于谁，
    URL 决定详情栏显示谁——一个是工作集，一个是游标。混进同一个 Set 的话，
    点开一个项目就会把它算进「已选」，接着点「联网检查更新」就带上了一个
    用户没勾过的项目。
  */
  const { id } = useParams()
  const currentId = Number(id) || null
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
    // 「我自己的」与分类 / 标签**叠加**，所以原样传下去
    own: filters.own,
    attention: filters.attention,
    sort: filters.sort,
  })

  const {
    data: statuses,
    error: statusesError,
    isFetching: statusesLoading,
    refetch: refetchStatuses,
  } = useStatuses((projects ?? []).map((p) => p.id))

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
      // 与左栏同一套：按显示名排，而不是按存进库的英文
      [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => categoryLabel(name)],
      ['asc', 'asc'],
    ).map(([name, items]) => ({ name, items, filterable: name !== UNCATEGORIZED }))
  }, [projects])

  /** 表里从上到下的行顺序——上下键要按这个走，而不是按 `projects` 的原顺序 */
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])

  /*
    注册只有清单页算得出来的命令：「全选」要知道当前筛出了哪些行，
    「检查更新」要决定检查勾选的那些还是当前筛选出的全部。
    挂载时注册、卸载时注销——菜单栏与快捷键问的就是这张表。
  */
  const setSelection = useUiStore((s) => s.setSelection)
  const clearSelection = useUiStore((s) => s.clearSelection)
  const openCreate = useUiStore((s) => s.openCreate)
  const toggleSelected = useUiStore((s) => s.toggleSelected)

  useEffect(() => {
    const ids = ordered.map((p) => p.id)
    const offs = [
      registerCommand('select-all', () => setSelection(ids)),
      registerCommand('clear-selection', clearSelection),
      registerCommand('open-create', openCreate),
      registerCommand('check-updates', () => setPanelOpen(true)),
      registerCommand('open-scan', () => navigate('/settings#scan')),
      registerCommand('focus-search', () => {
        document.getElementById('project-search')?.focus()
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [ordered, setSelection, clearSelection, openCreate, navigate])

  /* 行焦点：roving tabindex，整张表在 Tab 序里只占一个停靠点。 */
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  const focusRow = useCallback((id: number | null) => {
    setFocusedId(id)
    tbodyRef.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus()
  }, [])

  /** 相对 `from` 移动 delta 行 */
  const moveFocus = (from: number | null, delta: number) => {
    if (ordered.length === 0) return
    const at = from === null ? -1 : ordered.findIndex((p) => p.id === from)
    const next = at < 0 ? 0 : Math.min(ordered.length - 1, Math.max(0, at + delta))
    const row = ordered[next]
    if (row) focusRow(row.id)
  }

  const onTableKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    /*
      「现在是哪一行」**从事件所在的行读，不从 state 读**。
      state 只用来画 tabindex（让整张表在 Tab 序里只占一个停靠点），
      真要移动焦点时却去读它，就会踩到「刚点完一行、还没重渲染就按键」的时序：
      handler 闭包里的 focusedId 还是上一次的值，于是按 ↓ 停在原地。
      从 DOM 读永远是准的——行焦点本来就是 DOM 的事。
    */
    const row = (e.target as HTMLElement).closest('tr[data-row]') as HTMLElement | null
    const here = row ? Number(row.dataset.row) : null

    // 名字是链接、勾选框是 input、行内还有两个按钮——它们各自有原生行为，
    // 这里一律不插手。尤其 Space：焦点在勾选框上时浏览器自己会切换它，
    // 我们再来一次就是**双翻转**（按一下没反应或反着来）。
    const inControl = (e.target as HTMLElement).closest('input, a, button') !== null

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveFocus(here, 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        moveFocus(here, -1)
        return
      case ' ':
        if (inControl || here === null) return
        e.preventDefault()
        toggleSelected(here)
        return
      case 'Enter':
        if (inControl || here === null) return
        e.preventDefault()
        navigate(`/projects/${here}`)
        return
      case 'Delete':
        if (inControl || here === null) return
        e.preventDefault()
        setPendingRemoval(ordered.find((p) => p.id === here) ?? null)
        return
      default:
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorNote message="读不到项目清单。后端可能没启动——在仓库根目录跑 pnpm dev，再刷新这个页面。" />
      </div>
    )
  }

  return (
    <div className="pane-list">
      <Toolbar
        total={projects?.length ?? 0}
        onCheckUpdates={() => setPanelOpen(true)}
        onScan={() => navigate('/settings#scan')}
      />

      <ListHeader rows={ordered} />

      <div className="list-scroll px-4 pb-6">
        {/*
          状态那一列读不出来时必须说出来。原来这个错误被丢掉了（只解构了 data），
          于是超过服务端上限、后端挂了、超时——用户看到的都是每一行「读状态…」，
          永远不恢复，也没有任何解释。清单本身是好的，所以这里只挂一条可重试的提示，
          不把整页变成错误页。
        */}
        {statusesError && projects && projects.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-l-2 border-signal-bad bg-panel px-3 py-2">
            <span className="text-[13px] text-signal-bad">
              读不到仓库状态：{statusesError instanceof ApiError ? statusesError.message : '服务端没应答'}
              <span className="text-ink-3">（清单本身没问题，只有「落后 / 远程更新 / 上次检查」这几列是空的）</span>
            </span>
            <Button onClick={() => void refetchStatuses()} disabled={statusesLoading}>
              {statusesLoading ? '重试中…' : '重试'}
            </Button>
          </div>
        ) : null}

        {isPending ? (
          <p className="py-10 font-mono text-[13px] text-ink-3">正在读清单…</p>
        ) : !projects || projects.length === 0 ? (
          <EmptyList filtering={hasFilter(filters)} />
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
          <table className="list-table">
            <ColumnHeader />
            <tbody ref={tbodyRef} onKeyDown={onTableKeyDown}>
              {groups.flatMap((group) =>
                group.items.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    status={statuses?.get(p.id)}
                    current={currentId === p.id}
                    focused={focusedId === p.id}
                    onFocus={() => setFocusedId(p.id)}
                    onOpen={() => navigate(`/projects/${p.id}`)}
                    onRemove={() => setPendingRemoval(p)}
                  />
                )),
              )}
            </tbody>
          </table>
        )}
      </div>

      {pendingRemoval ? (
        <RemoveDialog project={pendingRemoval} onClose={() => setPendingRemoval(null)} />
      ) : null}
      {/* 报告是弹窗，不再插进页面流里（插进去会推移清单表，而且和表是同一套盒子语汇，
          屏幕上就同时出现两张「表」）。 */}
      {panelOpen ? (
        <UpdatePanel
          ids={selectedIds.length > 0 ? selectedIds : (projects ?? []).map((p) => p.id)}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
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
      body="先把已经在本机的仓库加进来：每加一个，清单上就多一行，之后就能在这里统一看着它们。路径填本地目录，例如 D:/Git/canvas-editor。"
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
 *
 * 列的取舍（都是用户提的）：
 * - **没有「记录」列**：那是要写长的一段东西，一列里塞个摘要没有意义；
 *   它只在「编辑资料」弹窗里编辑，详情页只读展示（原来还试过「摘要」「备注」两列，都撤了）。
 * - **「作者更新」改成「远程更新」**：原来那个名字说不清是"我还是作者"更新的。
 *   它和「落后」「推荐」是同一组——都是远程那边的事实；
 *   而"你什么时候看的"是「上次检查」，两回事。
 * - 右边这几列（落后 / 远程更新 / 推荐 / 上次检查）**统一右对齐**：
 *   它们都是"一个短值"，混着左右对齐看着就乱。
 */
function ColumnHeader() {
  return (
    <thead className="tr-tint column-header sticky top-0 z-[5]">
      <tr className="border-b border-line text-[11px] text-ink-3">
        <th className="col-check" />
        <th className="col-repo">仓库</th>
        <th className="col-branch">当前分支</th>
        <th className="col-attention">状态</th>
        <th className="col-sync">同步状态</th>
        <th className="col-delta text-right">差异</th>
        <th className="col-checked text-right">上次检查</th>
        <th className="col-actions" />
      </tr>
    </thead>
  )
}

/**
 * 分组下拉里「全部」的取值。**不能用空串**——空串是「未分类」这个合法筛选值，
 * 两个选项撞值的话，选了「未分类」下拉会显示成「全部」而筛的是空串：
 * 控件说的和它做的不一致。
 */
const ALL_GROUPS = '__all__'

/**
 * 工具条下面那一行：看全局的三件事（状态 / 分组 / 排序）加「全选」。
 *
 * 它与左栏的过滤面板**读写同一份 `filters`**。两边都留着是为了对比
 * （决定 8），所以两边必须是一份状态：各存一份的话，改了这边另一边不亮，
 * 用户会以为它们各筛各的。
 *
 * 「全选」选的是**当前筛出来的这些行**，不是库里全部——所以批量动作不会
 * 带走那些已经被筛掉的、用户根本没看见的项目。
 */
function ListHeader({ rows }: { rows: ProjectListItem[] }) {
  const filters = useUiStore((s) => s.filters)
  const setAttention = useUiStore((s) => s.setAttention)
  const setCategory = useUiStore((s) => s.setCategory)
  const setSort = useUiStore((s) => s.setSort)
  const selectedIds = useSelectedIds()
  const setSelection = useUiStore((s) => s.setSelection)
  const clearSelection = useUiStore((s) => s.clearSelection)
  const allSelected = rows.length > 0 && selectedIds.length === rows.length

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
        再按名称」，而下面的「按名称」是**纯名称序**（Task 2 的裁决）。让空值
        冒充「按名称」的话，下拉说的和实际排出来的不一样。
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

      <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
        <input
          type="checkbox"
          className="list-check"
          checked={allSelected}
          // 一行都没有时禁用：勾了等于没勾，是死控件
          disabled={rows.length === 0}
          onChange={(e) =>
            e.target.checked ? setSelection(rows.map((p) => p.id)) : clearSelection()
          }
        />
        全选
      </label>
    </div>
  )
}

/** 工具条上的下拉。用 `<label>` 包住，读屏拿到的是标签文字而不是没有名字的控件。 */
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

function Toolbar({
  total,
  onCheckUpdates,
  onScan,
}: {
  total: number
  onCheckUpdates: () => void
  onScan: () => void
}) {
  // 逐个字段订阅，而不是 `useUiStore()` 整店订阅 ——
  // 整店订阅会让「勾选任何一行」都重渲染整个顶栏（搜索框、三个按钮、计数）。
  const filters = useUiStore((s) => s.filters)
  const setQuery = useUiStore((s) => s.setQuery)
  const clearFilters = useUiStore((s) => s.clearFilters)
  const openCreate = useUiStore((s) => s.openCreate)
  const selectedCount = useSelectedCount()
  const filtering = hasFilter(filters)

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
      {filtering ? (
        <Button className="shrink-0" onClick={clearFilters}>
          <Eraser size={14} aria-hidden />
          清掉筛选
        </Button>
      ) : null}
      <span className="shrink-0 font-mono text-[12px] text-ink-3">
        {total} 个项目
        {selectedCount > 0 ? ` · 已选 ${selectedCount}` : ''}
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

function ProjectRow({
  project: p,
  status,
  current,
  focused,
  onFocus,
  onOpen,
  onRemove,
}: {
  project: ProjectListItem
  status: RepoStatus | undefined
  /** 这一行是不是正显示在右边详情栏里的那个 */
  current: boolean
  /** 行焦点（roving tabindex）：整张表在 Tab 序里只占一个停靠点 */
  focused: boolean
  onFocus: () => void
  onOpen: () => void
  onRemove: () => void
}) {
  const selected = useUiStore((s) => s.selected.has(p.id))
  const toggleSelected = useUiStore((s) => s.toggleSelected)
  const openEdit = useUiStore((s) => s.openEdit)
  // 目录没了：置灰但保留入口，让用户能改路径或移除——不自动消失
  const gone = status?.status === 'missing'

  return (
    <tr
      data-row={p.id}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      className={`row-link ${current ? 'row-current' : ''} ${gone ? 'opacity-50' : ''}`}
      title={gone ? '目录不在了。点「编辑资料」可以把它指到新位置。' : undefined}
      onClick={(e) => {
        /*
          整行可点。桌面软件的清单表是「点哪一行就选中哪一行」，
          只让名称那几个像素可点是网页的做法。

          但**行里有三个自带行为的元件**：勾选框、编辑、删除、名称链接。
          点到它们时不能顺带跳走——用户明明在点「删除」，却发现右栏
          也换了项目，那是在跟他抢点击。`closest` 一把排除掉。
        */
        if ((e.target as HTMLElement).closest('button, a, input')) return
        onOpen()
      }}
    >
      <td className="col-check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleSelected(p.id)}
          aria-label={`选择 ${p.name}`}
          className="list-check"
        />
      </td>
      {/*
        「仓库」一列把名称与路径并在一起（两行），不是两个列：列宽省下来的
        地方正好给「当前分支」腾位置，而路径本来就是「哪一份」的唯一凭据，
        跟在名字下面比单开一列更好认。
      */}
      <td className="col-repo">
        <span className="flex min-w-0 items-start gap-1.5">
          <FolderGit2 size={15} aria-hidden className="mt-[3px] shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {/*
                「我自己的」用图标而不是圆点：清单里已经有两列用颜色编码 git
                事实（状态 / 差异），再来一个圆点会让人以为是某种状态。
                灰色也是刻意的——它是你自己的标注，不是 git 报出来的事实。
                读屏读到的是「我自己的 bilibili-digest」。
                它**不是按钮**：可写字段只在「编辑资料」里改（不变量 13）。
              */}
              {p.isOwn ? (
                <>
                  {/* title 挂在外层 span 上：lucide 图标不接 title 属性 */}
                  <span className="shrink-0 text-ink-3" title="我自己的项目：批量检查默认跳过它">
                    <UserRound size={12} aria-hidden />
                  </span>
                  <span className="sr-only">我自己的</span>
                </>
              ) : null}
              <Link
                to={`/projects/${p.id}`}
                aria-current={current ? 'page' : undefined}
                className="min-w-0 cursor-pointer truncate text-[14px] font-semibold text-ink hover:text-accent-ink"
              >
                {p.name}
              </Link>
            </span>
            <span
              className="mt-px block truncate font-mono text-[11.5px] text-ink-3"
              title={p.path}
            >
              {p.path}
            </span>
          </span>
        </span>
      </td>

      <td className="col-branch">
        <span className="block truncate font-mono text-[12px] text-ink-2">
          {status && status.isRepo ? (status.detached ? '游离 HEAD' : (status.branch ?? '—')) : '—'}
        </span>
      </td>

      {/* 状态：读服务端算好的 attention，前端不按 verdict 重算 */}
      <td className="col-attention">
        <AttentionBadge
          attention={p.attention}
          checkedAt={p.latestCheck?.checkedAt ?? null}
        />
      </td>

      {/* 同步状态：全中性灰，刻意比左边那列低调——它是上下文，不是行动项 */}
      <td className="col-sync">
        <SyncBadge
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          upstreamGone={status?.upstreamGone ?? false}
          hasCheck={p.attention !== 'unchecked'}
        />
      </td>

      {/* 差异：两个方向都给。↓ 绿是「远程有新东西」，与状态列的「可更新」对得上 */}
      <td className="col-delta text-right">
        <Diff
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          hasCheck={p.attention !== 'unchecked'}
        />
      </td>

      <td
        className="col-checked truncate text-right font-mono text-[12px] text-ink-3"
        title={p.latestCheck ? `上次检查结果：${p.latestCheck.status}` : '还没检查过'}
      >
        {p.latestCheck ? formatRelative(p.latestCheck.checkedAt) : '没查过'}
      </td>
      <td className="col-actions">
        <span className="row-actions flex justify-end gap-1">
          <button
            onClick={() => openEdit(p.id)}
            title="编辑资料"
            aria-label={`编辑资料 ${p.name}`}
            className="cursor-pointer rounded-[3px] p-1 text-ink-2 hover:bg-paper hover:text-ink"
          >
            <Pencil size={13} aria-hidden />
          </button>
          <button
            onClick={onRemove}
            title="移出清单"
            aria-label={`移出清单 ${p.name}`}
            className="cursor-pointer rounded-[3px] p-1 text-ink-2 hover:bg-paper hover:text-signal-bad"
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
  const [banner, setBanner] = useState<string | null>(null)

  return (
    <Dialog title={`把 ${project.name} 移出清单？`} onClose={onClose}>
      <p className="text-[13px] text-ink-2">
        只删掉清单里这一条。磁盘上的 <span className="font-mono text-[12px]">{project.path}</span>{' '}
        和它的 git 历史都不动，你写的那段记录和标签关联会一起清掉。
      </p>
      {/* 删除失败不能一声不响地关门：用户会以为删掉了 */}
      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>留下</Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(project.id, {
              onSuccess: onClose,
              onError: (e) => setBanner(e instanceof ApiError ? e.message : '移除失败'),
            })
          }
        >
          <Trash2 size={14} aria-hidden />
          移出清单
        </Button>
      </div>
    </Dialog>
  )
}
