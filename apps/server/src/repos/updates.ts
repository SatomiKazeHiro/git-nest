import type { DB } from '../db/index.ts'
import type { UpdateReport } from '@git-nest/core/git'
import type { UpdateVerdict } from '@git-nest/core'

/**
 * `update_checks.detail` 的形状（JSON 列，故意不建表：只是给下一次检查留的备忘）。
 *
 * **只放「下次真的会用」的东西。** 原来还有 `incoming` / `outgoing` / `tags`
 * （提交数、这次看到的标签）——写进去之后**没有任何地方读**：两个数字在
 * `ahead_count` / `behind_count` 那两列里已经有了，标签只在注释里以
 * 「供以后趋势分析用」的名义躺着。
 *
 * 一个没人读的字段不是「以后可能有用」，它是**读的人必须逐个排除的噪声**：
 * 判断某个字段能不能删，得先把整个 server 搜一遍。将来真要做趋势分析再加回来——
 * 这张表是派生的（原话：删了重建没有代价），加字段不需要迁移。
 */
export interface UpdateCheckDetail {
  /** 这次算出的「推不推荐更新」的结论 */
  verdict?: UpdateVerdict
  /**
   * 那一刻是不是**确实有东西可拉**（safe 且落后）。
   *
   * 必须一起存：光凭 `verdict === 'safe'` 推不出来——「已是最新」与「本地领先」
   * 也都是 safe，但那时没有东西可拉。清单页要靠它决定要不要说「可更新」。
   */
  canPull?: boolean
  /** 这次看到的上游 SHA —— 下次检查靠它判「作者改写历史」 */
  upstreamSha?: string | null
  error?: unknown
}

/** 把一次检查/更新的结果记进历史，供「最后检查时间」「推荐更新」与后续趋势分析用。 */
export function recordUpdateCheck(db: DB, projectId: number, report: UpdateReport): void {
  const detail: UpdateCheckDetail = {
    ...(report.recommendation
      ? { verdict: report.recommendation.verdict, canPull: report.recommendation.canPull }
      : {}),
    ...(report.upstreamSha ? { upstreamSha: report.upstreamSha } : {}),
    ...(report.error ? { error: report.error } : {}),
  }
  db.prepare(
    `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    new Date().toISOString(),
    report.status,
    report.ahead,
    report.behind,
    JSON.stringify(detail),
  )
}

/**
 * 每个项目保留多少条流水。
 *
 * 自动 fetch 每 30 分钟给每个仓库写一行（48 行/天/仓库）。**注意：这张表已经
 * 退出读路径**——当前状态在 `repo_state`（一个仓库一行），这里只是追加的流水。
 * 上限留着是为了别让它无限长（50 个仓库一年约 87 万行）；将来没人看趋势就整张表删掉。
 */
export const KEEP_CHECKS_PER_PROJECT = 2000

/** 裁掉每个项目最老的历史，返回删掉的行数。 */
export function pruneUpdateChecks(db: DB, keepPerProject = KEEP_CHECKS_PER_PROJECT): number {
  const info = db
    .prepare(
      `DELETE FROM update_checks WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY id DESC) AS rn
           FROM update_checks
         ) WHERE rn > ?
       )`,
    )
    .run(keepPerProject)
  return info.changes
}
