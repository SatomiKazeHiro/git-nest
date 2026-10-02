import type { DB } from '../db/index.ts'
import type { UpdateReport } from '@git-nest/core/git'
import type { UpdateVerdict } from '@git-nest/core'

/** `update_checks.detail` 的形状（JSON 列，故意不建表：只是给下一次检查留的备忘）。 */
export interface UpdateCheckDetail {
  incoming: number
  outgoing: number
  tags: string[]
  /** 这次算出的「推不推荐更新」的结论 */
  verdict?: UpdateVerdict
  /** 这次看到的上游 SHA —— 下次检查靠它判「作者改写历史」 */
  upstreamSha?: string | null
  error?: unknown
}

/** 把一次检查/更新的结果记进历史，供「最后检查时间」「推荐更新」与后续趋势分析用。 */
export function recordUpdateCheck(db: DB, projectId: number, report: UpdateReport): void {
  const detail: UpdateCheckDetail = {
    incoming: report.incoming.length,
    outgoing: report.outgoing.length,
    tags: report.tags,
    ...(report.recommendation ? { verdict: report.recommendation.verdict } : {}),
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
 * 上次检查时上游指向的 SHA。
 *
 * 这是 `rewritten`（作者 force push）**唯一**的判据：只看本地 refs 是判不出来的
 * （那时本地 HEAD 仍是新历史的祖先，git 自己也会正常快进）。
 * 读不出来就返回 null —— 宁可判不出，也不要瞎判。
 */
export function lastUpstreamSha(db: DB, projectId: number): string | null {
  const row = db
    .prepare(
      `SELECT detail FROM update_checks
       WHERE project_id = ? AND detail IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId) as { detail: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.detail) as UpdateCheckDetail
    return typeof parsed.upstreamSha === 'string' && parsed.upstreamSha.length > 0
      ? parsed.upstreamSha
      : null
  } catch {
    return null
  }
}
