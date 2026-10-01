import type { DB } from '../db/index.ts'
import type { UpdateReport } from '@git-nest/core/git'

/** 把一次检查/更新的结果记进历史，供「最后检查时间」与后续趋势分析用。 */
export function recordUpdateCheck(db: DB, projectId: number, report: UpdateReport): void {
  db.prepare(
    `INSERT INTO update_checks (project_id, checked_at, status, ahead_count, behind_count, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    new Date().toISOString(),
    report.status,
    report.ahead,
    report.behind,
    JSON.stringify({
      incoming: report.incoming.length,
      outgoing: report.outgoing.length,
      tags: report.tags,
      ...(report.error ? { error: report.error } : {}),
    }),
  )
}
