import type { DB } from '../db/index.ts'
import type { UpdateReport } from '@git-nest/core/git'
import { REMOTE_CHECK_STATUSES, type UpdateVerdict } from '@git-nest/core'

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
 * 读最新一行；读不出来就返回 null —— 宁可判不出，也不要瞎判。
 *
 * **故意不往回翻更早的行**（这里踩过一次）：SHA 是**某一条上游 ref** 的值，
 * 而 `update_checks` 里不记那是哪一条。在 A 分支上检查过、切到 B 分支再检查时，
 * 拿 A 的 SHA 去问「它还是 B 的上游历史里的提交吗」，答案几乎必然是「不是」
 * ——于是报「作者改写了历史，别拉」。作者什么都没干，这是**假警报**，
 * 而假警报会把人引向错的方向（比「判不出来」坏得多）。
 * 最新一行没有 SHA（pull 之后那行）时返回 null，调用方会退回**本地 ref**
 * ——那个值天然属于当前这条上游 ref，不会串（见 `log.ts` 的基线说明）。
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
 *
 * **必须与清单页读的是同一批行**（`latestChecksByProject` 也按
 * `REMOTE_CHECK_STATUSES` 取最新一条）：否则会出现「界面写着别拉、服务端不拦」
 * ——原来这里读「最新一行」，而自动 fetch 每 30 分钟就会在断网时写一行没有 verdict
 * 的 error 记录，中间插进这么一行，闸就凭空松了。
 */
export function lastVerdict(
  db: DB,
  projectId: number,
): { verdict: UpdateVerdict; canPull: boolean } | null {
  const qualified = REMOTE_CHECK_STATUSES.map(() => '?').join(', ')
  const row = db
    .prepare(
      `SELECT detail FROM update_checks
        WHERE project_id = ? AND detail IS NOT NULL AND status IN (${qualified})
        ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId, ...REMOTE_CHECK_STATUSES) as { detail: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.detail) as UpdateCheckDetail
    if (!parsed.verdict) return null
    return { verdict: parsed.verdict, canPull: parsed.canPull === true }
  } catch {
    return null
  }
}

/**
 * 每个项目保留多少条历史。
 *
 * 自动 fetch 每 30 分钟给每个仓库写一行（48 行/天/仓库），而这份历史只被用来
 * 「读最近一个事实」——不清理的话它会一直长（50 个仓库一年约 87 万行）。
 * 2000 行 ≈ 一个仓库 40 天，够以后做「近 30 天更新了几次」那类分析，
 * 又给表加了个上限。只在批量任务收尾时调，不在每次写入时调。
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
