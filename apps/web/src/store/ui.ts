import { create } from 'zustand'

/** 未归类的项目在界面上归到这个桶 */
export const UNCATEGORIZED = '未分类'

export interface Filters {
  q: string
  category: string | null
  tag: string | null
}

interface UiState {
  filters: Filters
  selected: Set<number>
  /** 打开表单时为 null（新建），否则为正在编辑的项目 id */
  editingId: number | null
  formOpen: boolean
  setQuery: (q: string) => void
  setCategory: (c: string | null) => void
  setTag: (t: string | null) => void
  clearFilters: () => void
  toggleSelected: (id: number) => void
  setSelection: (ids: number[]) => void
  clearSelection: () => void
  openCreate: () => void
  openEdit: (id: number) => void
  closeForm: () => void
}

const emptyFilters: Filters = { q: '', category: null, tag: null }

export const useUiStore = create<UiState>((set) => ({
  filters: emptyFilters,
  selected: new Set<number>(),
  editingId: null,
  formOpen: false,

  setQuery: (q) => set((s) => ({ filters: { ...s.filters, q } })),
  setCategory: (category) =>
    set((s) => ({
      filters: { ...s.filters, category: s.filters.category === category ? null : category },
    })),
  setTag: (tag) =>
    set((s) => ({ filters: { ...s.filters, tag: s.filters.tag === tag ? null : tag } })),
  clearFilters: () => set({ filters: emptyFilters }),

  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selected: next }
    }),
  setSelection: (ids) => set({ selected: new Set(ids) }),
  clearSelection: () => set({ selected: new Set<number>() }),

  openCreate: () => set({ formOpen: true, editingId: null }),
  openEdit: (editingId) => set({ formOpen: true, editingId }),
  closeForm: () => set({ formOpen: false, editingId: null }),
}))
