import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

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
}

interface UiState {
  filters: Filters
  selected: Set<number>
  /** 打开表单时为 null（新建），否则为正在编辑的项目 id */
  editingId: number | null
  formOpen: boolean
  /** 左栏与详情栏可以折叠——桌面软件的窗格就该能收起来 */
  navOpen: boolean
  detailOpen: boolean
  setQuery: (q: string) => void
  setCategory: (c: string | null) => void
  setTag: (t: string | null) => void
  setOwnOnly: (v: boolean) => void
  clearFilters: () => void
  toggleSelected: (id: number) => void
  setSelection: (ids: number[]) => void
  clearSelection: () => void
  openCreate: () => void
  openEdit: (id: number) => void
  closeForm: () => void
  toggleNav: () => void
  toggleDetail: () => void
}

const emptyFilters: Filters = { q: '', category: null, tag: null, own: null }

export const useUiStore = create<UiState>((set) => ({
  filters: emptyFilters,
  selected: new Set<number>(),
  editingId: null,
  formOpen: false,
  navOpen: true,
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
  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  toggleDetail: () => set((s) => ({ detailOpen: !s.detailOpen })),
}))

/**
 * 已选项目的 id 列表。
 *
 * 直接订阅 `s.selected` 有两个坑：`toggleSelected` 每次都 new 一个 Set，
 * 所以**引用永远在变**，订阅它的组件每次勾选都会重渲染；而且拿到的 Set
 * 每次都是新对象，当 props 往下传时会把子组件的 memo 全部打穿。
 *
 * 这里用 `useShallow` 按**内容**比较，并把结果固定成数组：勾选集合没变
 * （哪怕 Set 是新对象）就不重渲染，变了也只在真正用到它的组件里更新。
 */
const EMPTY_IDS: number[] = []

export function useSelectedIds(): number[] {
  return useUiStore(useShallow((s) => (s.selected.size === 0 ? EMPTY_IDS : [...s.selected])))
}

/** 只关心「有没有选、选了几个」的地方用这个（返回基本类型，天然稳定）。 */
export function useSelectedCount(): number {
  return useUiStore((s) => s.selected.size)
}
