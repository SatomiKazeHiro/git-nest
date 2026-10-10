import type { Attention, ProjectSort } from '@git-nest/core'
import { create } from 'zustand'

/** 未归类的项目在界面上归到这个桶 */
export const UNCATEGORIZED = '未分类'

export interface Filters {
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
}

interface UiState {
  filters: Filters
  /** 打开表单时为 null（新建），否则为正在编辑的项目 id */
  editingId: number | null
  formOpen: boolean
  /** 详情栏可以折叠——桌面软件的窗格就该能收起来 */
  detailOpen: boolean
  setQuery: (q: string) => void
  setCategory: (c: string | null) => void
  setTag: (t: string | null) => void
  setOwnOnly: (v: boolean) => void
  setAttention: (a: Attention | null) => void
  /** 「全部仓库」只清这一个维度——分类 / 标签 / 我自己的都不动 */
  clearAttention: () => void
  setSort: (s: ProjectSort | null) => void
  clearFilters: () => void
  openCreate: () => void
  openEdit: (id: number) => void
  closeForm: () => void
  toggleDetail: () => void
}

const emptyFilters: Filters = { q: '', category: null, tag: null, own: null, attention: null, sort: null }

export const useUiStore = create<UiState>((set) => ({
  filters: emptyFilters,
  editingId: null,
  formOpen: false,
  detailOpen: true,

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
  setSort: (sort) => set((s) => ({ filters: { ...s.filters, sort } })),
  clearFilters: () => set({ filters: emptyFilters }),

  openCreate: () => set({ formOpen: true, editingId: null }),
  openEdit: (editingId) => set({ formOpen: true, editingId }),
  closeForm: () => set({ formOpen: false, editingId: null }),
  toggleDetail: () => set((s) => ({ detailOpen: !s.detailOpen })),
}))
