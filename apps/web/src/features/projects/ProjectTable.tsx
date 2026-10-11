import { useMemo } from 'react'
import { groupBy, orderBy } from 'es-toolkit'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  DEFAULT_SORT_DIR,
  categoryLabel,
  type ProjectListItem,
  type ProjectSort,
  type RepoStatus,
} from '@git-nest/core'
import { Button, EmptyState } from '@/components/ui'
import { hasFilter, UNCATEGORIZED, useUiStore } from '@/store/ui'
import { ProjectRow } from './ProjectRow'

/**
 * 清单表：**一个表头 + 平铺的行**。三种状态都在这里——正在读 / 空 / 有行。
 *
 * 分组只用来**排序**，不是表里的结构。这里踩过两个坑，都是「把分组塞进表里」
 * 造成的：
 * 1. 最早是每个分区一个 `<ul>` + 各印一份表头 → 好几张表叠着。
 * 2. 后来改成一张表，却把分区渲染成一整行分隔条（`colSpan` 的 `<tr>`）
 *    → 换汤不换药，看着还是「一坨分区叠着一坨」。
 *
 * 现在表里**完全没有分区这回事**：分类是侧栏的事（点一下就筛那一类），
 * 在表里再来一层就是重复。行按分类排序，同类自然连在一起。
 *
 * 空状态也放在这里，因为它得先回答「是筛没了，还是本来就空」——那是这份数据的
 * 上下文，从外面传进来只会让调用方重复算一遍。
 */
export function ProjectTable({
  projects,
  statuses,
  currentId,
  isPending,
  onOpen,
  onRemove,
}: {
  projects: ProjectListItem[] | undefined
  /** 批量状态。**可能缺**（读失败时整列就是空的），所以每一列都要能显示「—」 */
  statuses: Map<number, RepoStatus> | undefined
  currentId: number | null
  isPending: boolean
  onOpen: (id: number) => void
  onRemove: (project: ProjectListItem) => void
}) {
  const sort = useUiStore((s) => s.filters.sort)

  /**
   * 行怎么排。
   *
   * **只有「默认」排序才按分类重新分组。** 其它排序是服务端给的**全局序**
   * （`sort=name` 那支特意是纯名称序，服务端还有一条测试钉着），这里再按分类
   * 切一遍会把它打散：按名称就变成「先分类、再名称」，跨类上和「默认」长得
   * 一模一样——下拉说的和实际排出来的不一样，正是要避免的那类问题。
   *
   * 分类只是排序依据、不是表里的结构：表里没有分区行（分类是侧栏的事），
   * 默认序里保留它只是因为「同类连在一起」好读。
   */
  const groups = useMemo(() => {
    if (sort) return [{ items: projects ?? [] }]
    const byCategory = groupBy(projects ?? [], (p) => p.category || UNCATEGORIZED)
    return orderBy(
      Object.entries(byCategory),
      // 与左栏同一套：按显示名排，而不是按存进库的英文
      [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => categoryLabel(name)],
      ['asc', 'asc'],
    ).map(([, items]) => ({ items }))
  }, [projects, sort])

  if (isPending) {
    return <p className="py-10 font-mono text-[13px] text-ink-3">正在读清单…</p>
  }
  if (!projects || projects.length === 0) {
    return <EmptyList />
  }

  return (
    <table className="list-table">
      <ColumnHeader />
      <tbody>
        {groups.flatMap((group) =>
          group.items.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              status={statuses?.get(p.id)}
              current={currentId === p.id}
              onOpen={() => onOpen(p.id)}
              onRemove={() => onRemove(p)}
            />
          )),
        )}
      </tbody>
    </table>
  )
}

/** 空列表。**先分清「筛没了」和「本来就空」**——这两件事的下一步动作完全不同。 */
function EmptyList() {
  const filters = useUiStore((s) => s.filters)
  const openCreate = useUiStore((s) => s.openCreate)
  const clearFilters = useUiStore((s) => s.clearFilters)

  return hasFilter(filters) ? (
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
        <SortableTh label="仓库" sortKey="name" hint="按名称排序" className="col-repo" />
        {/* 这三列没有排序键，所以是纯文字：**点了没反应的控件比没有更糟**。
            状态那一列的「行动分类」是服务端 SQL 算出来的，不是库里的一列。 */}
        <th className="col-branch">当前分支</th>
        <th className="col-attention">状态</th>
        <th className="col-sync">同步状态</th>
        {/* 「差异」这一列画的是 ↑领先 / ↓落后两个数，而排序键只有落后数 */}
        <SortableTh
          label="差异"
          sortKey="behind"
          hint="按落后数排序"
          className="col-delta"
          align="right"
        />
        <SortableTh
          label="上次检查"
          sortKey="checked"
          hint="按上次检查时间排序"
          className="col-checked"
          align="right"
        />
        <th className="col-actions" />
      </tr>
    </thead>
  )
}

/**
 * 可排序的表头：点一下按这一列排，再点翻方向。
 *
 * 三个排序键各有**自己的默认方向**（名称升序、时间与落后数降序，见
 * `DEFAULT_SORT_DIR`）：第一次点得到的就是原来那个下拉选出来的顺序，
 * 所以「点表头」不是另一套语义，只是同一条路更近的入口。
 *
 * `aria-sort` 也一起给：读屏要能说出「这一列正按升序排」，不能只靠一个箭头。
 * 箭头占位的 `w-3` 是固定的，所以出现/消失时标签不会左右跳。
 */
function SortableTh({
  label,
  sortKey,
  hint,
  className = '',
  align = 'left',
}: {
  label: string
  sortKey: ProjectSort
  /** tooltip 里说清这一列排的是什么（「差异」排的是落后数，不是两个数的和） */
  hint: string
  className?: string
  align?: 'left' | 'right'
}) {
  const sort = useUiStore((s) => s.filters.sort)
  const dir = useUiStore((s) => s.filters.dir)
  const setSort = useUiStore((s) => s.setSort)

  const active = sort === sortKey
  const current = dir ?? DEFAULT_SORT_DIR[sortKey]
  const ascending = current === 'asc'

  return (
    <th
      className={className}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        /* 已经是这一列 → 翻方向；不是 → 换成它并用它的默认方向（`dir` 不传） */
        onClick={() => setSort(sortKey, active ? (ascending ? 'desc' : 'asc') : undefined)}
        title={active ? `${hint}：当前${ascending ? '升序' : '降序'}，点一下改${ascending ? '降序' : '升序'}` : hint}
        className={`flex w-full cursor-pointer items-center gap-1 hover:text-ink ${
          align === 'right' ? 'justify-end' : ''
        }`}
      >
        {label}
        <span className="w-3 shrink-0" aria-hidden>
          {active ? ascending ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
        </span>
      </button>
    </th>
  )
}
