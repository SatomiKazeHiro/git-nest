import { useMutation, useQuery } from '@tanstack/react-query'
import { builtinCategoryList, type Category } from '@git-nest/core'
import { api } from '@/lib/api'
import { useInvalidate } from '@/lib/invalidate'
import { queryKeys } from '@/lib/queryKeys'

/**
 * 分类的数据访问。
 *
 * **两个读取口，不是一个**，区别在「加载中该显示什么」：
 *
 * - `useCategoriesQuery()`：原始状态，给**需要真实引用数**的地方（设置页）。
 *   加载中就是加载中——拿内置那四个冒充会让「0 个项目」变成一句假话。
 * - `useCategories()`：带兜底，给只需要「key → 显示名」的地方（左栏、表单、详情页）。
 *   接口没回来或失败时退回内置四个，于是那三处永远不会闪空、也不会把 `ai`
 *   这种 key 原样摆出来。内置四个任何时候都成立，它们不需要等网络。
 */

/**
 * 兜底值在**模块层**造一次。
 *
 * 每次渲染都新建一个数组的话，引用变了，用它做依赖的 `useMemo`（左栏那个分组）
 * 每次渲染都会重算——不致命，但那是白算，而且会让「依赖数组里写不写它」变成一个
 * 说不清的问题。
 */
const BUILTIN_FALLBACK: Category[] = builtinCategoryList()

export function useCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.get<{ categories: Category[] }>('/categories').then((r) => r.categories),
    // 分类是配置：不像清单那样每屏都在变，没必要每次挂载都问一次
    staleTime: 5 * 60_000,
  })
}

export function useCategories(): Category[] {
  const { data } = useCategoriesQuery()
  return data ?? BUILTIN_FALLBACK
}

/** 新增。key 由服务端从名称生成，调用方只给名字（图标这轮只存不选）。 */
export function useCreateCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { label: string; icon?: string | null }) =>
      api.post<{ category: Category }>('/categories', input),
    onSuccess: invalidate,
  })
}

/** 改名 / 改图标。**key 不改**：每个项目的 `category` 里存的就是它。 */
export function useUpdateCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { key: string; label?: string; icon?: string | null }) =>
      api.patch<{ category: Category }>(`/categories/${input.key}`, {
        label: input.label,
        icon: input.icon,
      }),
    onSuccess: invalidate,
  })
}

/** 删除。服务端会把引用它的项目退回「未分类」，并回答影响了几个（确认框要用）。 */
export function useRemoveCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (key: string) =>
      api.del<{ removed: number; moved: number }>(`/categories/${key}`),
    onSuccess: invalidate,
  })
}
