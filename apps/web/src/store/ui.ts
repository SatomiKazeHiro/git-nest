import { DEFAULT_SORT_DIR, type Attention, type ProjectSort, type SortDir } from '@git-nest/core'
import { create } from 'zustand'

/** 未归类的项目在界面上归到这个桶 */
export const UNCATEGORIZED = '未分类'

interface Filters {
  q: string
  category: string | null
  tag: string | null
  /**
   * 只看我自己的项目。
   *
   * **和 category / tag 叠加，不互斥**——「我的 tools」是一个合理的查询。
   * 所以 `setOwnOnly` 不去动另外两个条件（只有左栏的分类/标签项会互相取消，
   * 因为它们本来就是同一层的两种分组方式）。
   */
  own: '1' | '0' | null
  /**
   * 行动分类筛选；null = 不筛。
   *
   * 与分类 / 标签**叠加**，各自独立开关。
   */
  attention: Attention | null
  /** 列表排序；null = 用服务端默认（分类分组 → 名称） */
  sort: ProjectSort | null
  /**
   * 排序方向。**只在 `sort` 有值时才有意义**，`sort` 一清它也跟着清
   * ——留一个孤儿方向只会让下一次点表头猜错方向。
   */
  dir: SortDir | null
}

/**
 * 「现在有筛选吗」。
 *
 * **不能用真值判断**：`category === ''` 是一个合法的筛选值（「只看没分类的」）。
 * 真值判断会把它当成没筛选，于是两处同时失灵——工具条上的「清掉筛选」按钮
 * 不出现，空状态也不说「换个条件看看」，用户就被卡在这里了。
 *
 * 它住在 store 里，因为这是**这份状态自己的语义**：工具条与空状态都要问这一句，
 * 各写一遍迟早只改一处（原来它挂在清单页文件里，靠一条注释约束两处不许飘开）。
 */
export function hasFilter(filters: Filters): boolean {
  return Boolean(filters.q || filters.tag || filters.own || filters.attention) || filters.category !== null
}

interface UiState {
  filters: Filters
  /** 打开表单时为 null（新建），否则为正在编辑的项目 id */
  editingId: number | null
  formOpen: boolean
  /** 设置弹窗开着吗（设置只有这一个界面，旧路由已删） */
  settingsOpen: boolean
  /** 扫描目录弹窗开着吗。它原来是设置里的一段，现在是独立的一个 */
  scanOpen: boolean
  setQuery: (q: string) => void
  setCategory: (c: string | null) => void
  setTag: (t: string | null) => void
  setOwnOnly: (v: boolean) => void
  setAttention: (a: Attention | null) => void
  /** 「全部仓库」只清这一个维度——分类 / 标签 / 我自己的都不动 */
  clearAttention: () => void
  /**
   * 设排序。`dir` 不传就用**这个键的默认方向**（名称升序、时间/落后降序）——
   * 于是「下拉里选一项」和「第一次点某个表头」得到的是同一个顺序。
   */
  setSort: (s: ProjectSort | null, dir?: SortDir) => void
  clearFilters: () => void
  openCreate: () => void
  openEdit: (id: number) => void
  closeForm: () => void
  openSettings: () => void
  closeSettings: () => void
  /** 扫描目录弹窗。它原来住在设置里，现在是独立的一个（工具条那枚按钮直接开它） */
  openScan: () => void
  closeScan: () => void
}

const emptyFilters: Filters = {
  q: '',
  category: null,
  tag: null,
  own: null,
  attention: null,
  sort: null,
  dir: null,
}

export const useUiStore = create<UiState>((set) => ({
  filters: emptyFilters,
  editingId: null,
  formOpen: false,
  settingsOpen: false,
  scanOpen: false,

  setQuery: (q) => set((s) => ({ filters: { ...s.filters, q } })),
  setCategory: (category) =>
    set((s) => ({
      filters: { ...s.filters, category: s.filters.category === category ? null : category },
    })),
  setTag: (tag) =>
    set((s) => ({ filters: { ...s.filters, tag: s.filters.tag === tag ? null : tag } })),
  // 点第二下就是取消：只有 true / false 两个取值，不做三态
  setOwnOnly: (v) => set((s) => ({ filters: { ...s.filters, own: v ? '1' : null } })),
  setAttention: (attention) => set((s) => ({ filters: { ...s.filters, attention } })),
  clearAttention: () => set((s) => ({ filters: { ...s.filters, attention: null } })),
  setSort: (sort, dir) =>
    set((s) => ({
      filters: { ...s.filters, sort, dir: sort === null ? null : (dir ?? DEFAULT_SORT_DIR[sort]) },
    })),
  clearFilters: () => set({ filters: emptyFilters }),

  openCreate: () => set({ formOpen: true, editingId: null }),
  openEdit: (editingId) => set({ formOpen: true, editingId }),
  closeForm: () => set({ formOpen: false, editingId: null }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openScan: () => set({ scanOpen: true }),
  closeScan: () => set({ scanOpen: false }),
}))
