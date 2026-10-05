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
    incoming: report.incoming.length,
    outgoing: report.outgoing.length,
    tags: report.tags,
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

/**
 * 上次检查算出的判决（`rewritten` / `unrelated` / …）。
 *
 * **给「更新」那一步做服务端兜底用**：前端已经把「别拉」那些的勾选框禁掉了，
 * 但那是建议——直接打 `POST /api/updates/apply` 能绕过去，所以这道闸必须也在服务端。
 *
 * 读的是**库里存的结论**，不是现算：结论本来就要求落库（见 `VERDICT_REASON` 的注释，
 * 「结论要落库、之后要能原样重建」），而现算要多跑 4 次 git 命令。
 * 代价是它反映的是**上次检查**那一刻的判断——所以给用户的理由里写明了这一点。
 */
export function lastVerdict(
  db: DB,
  projectId: number,
): { verdict: UpdateVerdict; canPull: boolean } | null {
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
    if (!parsed.verdict) return null
    return { verdict: parsed.verdict, canPull: parsed.canPull === true }
  } catch {
    return null
  }
}
