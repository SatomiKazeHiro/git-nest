import type { DB } from '../db/index.ts'
import { analyze, type UpdateReport } from './git.ts'
import { writeRepoState } from '../repos/repo-state.ts'
import { lastUpstreamSha, recordUpdateCheck } from '../repos/updates.ts'

/**
 * **取一个仓库此刻的远程状态：唯一的入口。**
 *
 * `docs/软件定位.md` §2 的全部内容就是这一句话：
 *
 * ```
 * sync(仓库) = fetch + 算  →  RepoState
 * update(仓库) = sync(仓库) + ff-only
 * ```
 *
 * 检查、顶部刷新、定时同步、单仓库重试**都是它的触发器**，不是它的替代品。
 * 以前这些调用点各自 `analyze()` + `recordUpdateCheck()`（更新那条路更是一份
 * 独立实现），于是同一个事实有了第二、第三种读法——见定位文档 §10 第一行。
 *
 * ## 它写两处，各自分工
 *
 * - `repo_state`（**当前值**，主体）：界面与后续判断都读它；
 * - `update_checks`（**流水**，旁路）：追加一行，只写不读。
 *
 * 两个都写、且都只在这一个函数里写——「谁改了这个仓库的状态」于是只有一个答案。
 * 流水将来要删就删，不影响任何读路径。
 */
export async function syncRepo(
  db: DB,
  project: { id: number; path: string },
  options: {
    /** 真正开始跑（排队等着不算）时回调：批量任务用它把行标成「检查中」 */
    onStart?: () => void
    /** 进命令日志的标签：`check` / `auto-fetch` / `update` … */
    label?: string
  } = {},
): Promise<UpdateReport> {
  const report = await analyze(project.path, {
    // 基线必须从库里读：core 不认识数据库，而「作者改写历史」只能靠上次见过的上游 SHA
    lastUpstreamSha: lastUpstreamSha(db, project.id),
    projectId: project.id,
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.onStart === undefined ? {} : { onStart: options.onStart }),
  })

  writeRepoState(db, project.id, report)
  recordUpdateCheck(db, project.id, report)
  return report
}
