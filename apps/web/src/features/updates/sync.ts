import { useInvalidate } from '@/lib/invalidate'
import { isPull, useUpdateTask } from './taskStream'

/**
 * 「同步 / 更新一个或一批仓库」——**界面里唯一的一份**。
 *
 * 弹窗删掉之后，这两个动作出现在三个地方（清单的行内按钮、详情页那颗「联网同步」、
 * 以及将来可能的批量），如果每处各写一份 `useUpdateTask` + 一份状态映射，
 * 它们迟早会说不一样的话（一个说「更新中…」另一个说「更新失败」）。
 * 所以：**哪个按钮都不许自己拼状态**，都从这里拿。
 *
 * 与「顶部刷新」的分工（两者不是同一件事）：
 * - `syncAll` / `syncOne`：跑一次同步（fetch + 算），产出状态。行内与详情页用它；
 * - 顶部刷新：调 `POST /api/auto-fetch`，后台整批跑一轮、不建任务、不开进度条
 *   ——它要的是「让全清单变新」，不是「盯着一行看」。
 */
export function useSync() {
  const invalidate = useInvalidate()
  const { task, busy, error, startCheck, startApply } = useUpdateTask(() => invalidate())

  /**
   * 某一行现在是什么状态。没有 = 这一轮没轮到它。
   *
   * 只产「按钮上那一小句」：行内放不下整句原因，所以要配 `title` 用。
   */
  const stateOf = (id: number) => {
    const item = task?.items.find((i) => i.projectId === id)
    if (!item) return null
    if (item.state === 'pending' || item.state === 'running') {
      return { busy: true, failed: false, text: '更新中…' }
    }
    if (item.state === 'failed') {
      return { busy: false, failed: true, text: item.error ?? '更新失败' }
    }
    return {
      busy: false,
      failed: false,
      text: isPull(item.result) ? item.result.summary : '已更新',
    }
  }

  return {
    task,
    busy,
    error,
    /** 同步全部（服务端按设置跳过「我自己的」） */
    syncAll: () => startCheck(),
    /** 同步**指定的一个**：用户点名要它，所以显式带上「我自己的」 */
    syncOne: (id: number) => startCheck([id], true),
    /** 更新**指定的一个**：只 ff-only，只动这一个仓库 */
    updateOne: (id: number) => startApply([id]),
    stateOf,
  }
}
