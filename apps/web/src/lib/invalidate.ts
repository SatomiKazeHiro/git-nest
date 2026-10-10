import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './queryKeys'

/**
 * 任何写操作后都让清单与标签重新对齐。
 *
 * 这里是**唯一**的失效入口：状态列、检查时间、设置都可能被一次写入影响
 * （比如删项目会清状态缓存、导入会改常用目录），所以一起失效最省心，
 * 也免得某处漏掉一个 key 导致界面停在旧数据上。
 *
 * ⚠️ 详情那一行必须是**前缀** `['project']`，不能写成 `queryKeys.project(0)`：
 * TanStack 的失效是前缀匹配，`['project', 0]` 只匹配 id 恰好为 0 的那条
 * （那是「没选中任何项目」时 `enabled: false` 的占位键），
 * 于是**任何写操作都失效不掉 `['project', id]`**——改完资料详情页还是旧名字、
 * 旧分类、旧记录，用户会以为没保存。这条踩过一次，注释钉在这里。
 *
 * **为什么它住在 `lib/` 而不是某个 feature 的 queries 里**：这是**跨域政策**，
 * 不属于任何一个业务。以前它在 `features/projects/queries.ts` 里，于是
 * `features/settings` 与 `features/updates` 都得 import 项目这个 feature
 * 才能刷新自己改动的后果——设置页为什么要认识「项目模块」？说不通。
 * 下沉到这里之后，它只认识契约表（`lib/queryKeys.ts`），谁都不认识。
 */
export function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.projects({}) })
    void qc.invalidateQueries({ queryKey: queryKeys.projectAll })
    void qc.invalidateQueries({ queryKey: queryKeys.tags })
    void qc.invalidateQueries({ queryKey: queryKeys.statusRoot })
    void qc.invalidateQueries({ queryKey: queryKeys.settings })
  }
}
