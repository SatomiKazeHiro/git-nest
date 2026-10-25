import { REMOTE_CHECK_STATUSES, type UpdateStatus, type UpdateVerdict } from '@git-nest/core'
import type { UpdateReportEntry } from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import type { UpdateReport } from '../lib/git.ts'

/**
 * 每个仓库一行的「当前状态」（主体业务表）。见 `docs/软件定位.md` §3：
 *
 * > 一个仓库在主体表里只有一行，那一行就是它此刻的全部结论。
 *
 * 三条规矩，读这个文件时先记住：
 *
 * 1. **只有 `sync()` 会写它**（`lib/sync.ts`），所以「谁改了这个仓库的状态」永远
 *    只有一个答案。别在别处 `UPDATE repo_state`。
 *
 *    **唯一的一个删除口是 `clearRepoState()`**，而且只有一种场景会用到：项目被
 *    重新指到了另一个目录（改了 `path`）。那时候这一行描述的是**旧目录那个仓库**，
 *    留着它就是把别人的结论挂在这个项目上——所以不是写个空值，是删掉。
 * 2. **合格的同步才覆盖结论**。失败的尝试只写 `attempt_at` / `error`——一次断网
 *    不该把上次的好结论擦成「没查过」（那是最容易让人误判的方向）。
 * 3. **`incoming` 只留前几条**：这张表是当前状态，不是提交列表的存档。要给用户看
 *    更多，走「展开时再读」那条路，别把 50 条塞进每一行。
 */

/** 行内显示够用几条提交。多存的唯一后果是每行都变肥。 */
export const INCOMING_KEEP = 4

/** 一次同步算出来的、只属于**远程**的那些事实（本地事实现场读，不入库）。 */
export interface RepoState {
  projectId: number
  /** 最近一次**合格**同步的时间：界面上的「上次检查」与新鲜度都用它 */
  checkedAt: string
  status: UpdateStatus
  ahead: number | null
  behind: number | null
  /** 「推不推荐更新」的结论；null = 没算出来（没查过 / 这次出错） */
  verdict: UpdateVerdict | null
  /** 此刻是不是确实有东西可拉（safe 且落后） */
  canPull: boolean
  /** 这次看到的上游 SHA —— 下次判「作者改写历史」的基线 */
  upstreamSha: string | null
  /** 要拉进来的前 {@link INCOMING_KEEP} 条 */
  incoming: UpdateReportEntry[]
  /** 最近一次**尝试**（成功或失败）的时间 */
  attemptAt: string
  /** 最近一次尝试得出的状态（失败时是 error / no_remote…，与 status 是两件事） */
  attemptStatus: UpdateStatus
  /** 最近一次尝试的失败原因（原样存 JSON，读出来是 unknown）；null = 没失败 */
  error: string | null
}

interface Row {
  project_id: number
  checked_at: string
  status: string
  ahead: number | null
  behind: number | null
  verdict: string | null
  can_pull: number
  upstream_sha: string | null
  incoming: string
  attempt_at: string
  attempt_status: string
  error: string | null
}

/**
 * 把一次同步的结果写进「当前状态」。
 *
 * 合格状态（`REMOTE_CHECK_STATUSES`：up_to_date / behind / ahead / diverged）覆盖
 * 全部结论；其余（error / no_remote / no_upstream / not_a_repo…）**只**记尝试与错误。
 * 没有旧行时也会落一行——「这个仓库从没成功同步过、最近一次为什么失败」本身是信息。
 */
export function writeRepoState(
  db: DB,
  projectId: number,
  report: UpdateReport,
  at = new Date().toISOString(),
): void {
  const qualified = (REMOTE_CHECK_STATUSES as readonly string[]).includes(report.status)
  const error = report.error ? JSON.stringify(report.error) : null

  if (qualified) {
    db.prepare(
      `INSERT INTO repo_state
         (project_id, checked_at, status, ahead, behind, verdict, can_pull,
          upstream_sha, incoming, attempt_at, attempt_status, error)
       VALUES (@projectId, @at, @status, @ahead, @behind, @verdict, @canPull,
               @upstreamSha, @incoming, @at, @status, @error)
       ON CONFLICT(project_id) DO UPDATE SET
         checked_at   = excluded.checked_at,
         status       = excluded.status,
         ahead        = excluded.ahead,
         behind       = excluded.behind,
         verdict      = excluded.verdict,
         can_pull     = excluded.can_pull,
         upstream_sha = excluded.upstream_sha,
         incoming     = excluded.incoming,
         attempt_at     = excluded.attempt_at,
         attempt_status = excluded.attempt_status,
         error          = excluded.error`,
    ).run({
      projectId,
      at,
      status: report.status,
      ahead: report.ahead,
      behind: report.behind,
      verdict: report.recommendation?.verdict ?? null,
      canPull: report.recommendation?.canPull ? 1 : 0,
      upstreamSha: report.upstreamSha,
      incoming: JSON.stringify(report.incoming.slice(0, INCOMING_KEEP)),
      error,
    })
    return
  }

  /*
    不合格的一次：**结论一个字都不动**，只记「什么时候试过、为什么没成」。
    目标行还不存在时补一行骨架（status 取这次的），
    这样界面能说清「这个仓库从没同步成功过」而不是「它在清单里但没有状态」。
  */
  db.prepare(
    `INSERT INTO repo_state
       (project_id, checked_at, status, ahead, behind, verdict, can_pull,
        upstream_sha, incoming, attempt_at, attempt_status, error)
     VALUES (@projectId, @at, @status, NULL, NULL, NULL, 0, NULL, '[]', @at, @status, @error)
     ON CONFLICT(project_id) DO UPDATE SET
       attempt_at     = excluded.attempt_at,
       attempt_status = excluded.attempt_status,
       error          = excluded.error`,
  ).run({ projectId, at, status: report.status, error })
}

/**
 * 把一个项目的「当前状态」整行删掉。**只在项目被重新指到另一个目录时调用**
 * （`PATCH /projects/:id` 真的改了 `path` 的那一刻）。
 *
 * 为什么是删而不是写个空结论：这一行描述的是**旧目录那个仓库**——检查时间、判决、
 * 基线 SHA、待拉的提交，全都属于另一个目录。留着它，界面上就会出现「这个目录
 * 25 分钟前联网查过」这种不成立的话（详情卡的时间来自旧目录，事实却是现读新目录的），
 * 清单那一列也会继续显示旧仓库的 `↓22`。删掉之后界面说的是「没查过」——那才是真的。
 *
 * 顺带把 `upstream_sha` 那条基线也一起清掉了，这是必要的：旧基线指向另一个仓库，
 * 拿它去判「作者改写历史」会得出无意义的结论（详见 `readBaselinePresence` 对
 * 未知 SHA 的处理）。
 *
 * 别在别处调用它。规矩没变：**结论只有 `sync()` 写**，这里是唯一允许删的入口。
 */
export function clearRepoState(db: DB, projectId: number): void {
  db.prepare('DELETE FROM repo_state WHERE project_id = ?').run(projectId)
}

/** 读一个仓库的当前状态。没有行 = 从没同步过。 */
export function readRepoState(db: DB, projectId: number): RepoState | null {
  const row = db.prepare('SELECT * FROM repo_state WHERE project_id = ?').get(projectId) as
    | Row
    | undefined
  return row ? toState(row) : null
}

/** 批量读（清单页一次要几十个）。返回按 project_id 索引的 Map。 */
export function readRepoStates(db: DB, projectIds?: number[]): Map<number, RepoState> {
  const rows = (
    projectIds && projectIds.length > 0
      ? db
          .prepare(
            `SELECT * FROM repo_state WHERE project_id IN (${projectIds.map(() => '?').join(',')})`,
          )
          .all(...projectIds)
      : db.prepare('SELECT * FROM repo_state').all()
  ) as Row[]
  return new Map(rows.map((r) => [r.project_id, toState(r)]))
}

/**
 * 下次判「作者改写历史」的基线：上一次**合格**同步看到的上游 SHA。
 *
 * 失败的一次不动这一列（见 `writeRepoState`）：基线本来就该是「我们上次真的
 * 问过远程时看到的值」，断网那几次没有提供新事实。读不出来就返回 null，
 * 调用方会退回「本机 ref 现在指着谁」——那个值天然属于当前这条上游 ref。
 */
export function upstreamBaseline(db: DB, projectId: number): string | null {
  const row = db.prepare('SELECT upstream_sha FROM repo_state WHERE project_id = ?').get(projectId) as
    | { upstream_sha: string | null }
    | undefined
  return row?.upstream_sha ?? null
}

/**
 * 上一次合格同步算出的判决——**「更新」那一步的服务端闸**。
 *
 * 前端把「别拉」那些的勾选框禁掉只是建议（直接打 `POST /updates/apply` 绕得过去），
 * 所以这道闸必须在服务端，且读的是**库里那条结论**而不是现算：
 * 现算要多跑 4 次 git 命令，而且改判据会导致「界面写着别拉、服务端不拦」。
 * 与界面读的是同一行（`repos/projects.ts` 的 `latestChecksByProject`）。
 */
export function stateVerdict(
  db: DB,
  projectId: number,
): { verdict: UpdateVerdict; canPull: boolean } | null {
  const row = db
    .prepare('SELECT verdict, can_pull FROM repo_state WHERE project_id = ?')
    .get(projectId) as { verdict: string | null; can_pull: number } | undefined
  if (!row?.verdict) return null
  return { verdict: row.verdict as UpdateVerdict, canPull: row.can_pull === 1 }
}

function toState(row: Row): RepoState {
  let incoming: UpdateReportEntry[] = []
  try {
    const parsed = JSON.parse(row.incoming) as unknown
    // 守卫是必要的，不是防自己的写入：列里存的可能是上一个版本写进去的形状
    if (Array.isArray(parsed)) incoming = parsed as UpdateReportEntry[]
  } catch {
    // 读不懂就当没有——但状态其余字段仍然可信，不该因为它整行作废
    incoming = []
  }
  return {
    projectId: row.project_id,
    checkedAt: row.checked_at,
    status: row.status as UpdateStatus,
    ahead: row.ahead,
    behind: row.behind,
    verdict: (row.verdict ?? null) as UpdateVerdict | null,
    canPull: row.can_pull === 1,
    upstreamSha: row.upstream_sha,
    incoming,
    attemptAt: row.attempt_at,
    attemptStatus: row.attempt_status as UpdateStatus,
    error: row.error,
  }
}
