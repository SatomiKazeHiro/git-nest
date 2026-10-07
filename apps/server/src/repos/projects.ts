import type { DB } from '../db/index.ts'
import {
  REMOTE_CHECK_STATUSES,
  VERDICT_LABEL,
  isRemoteCheckStatus,
  recommendationFrom,
  type Project,
  type ProjectDetail,
  type ProjectListItem,
  type Tag,
  type UpdateCheckSummary,
  type UpdateRecommendation,
  type UpdateVerdict,
} from '@git-nest/core'

interface ProjectRow {
  id: number
  name: string
  path: string
  remote_url: string | null
  /** 我自己写的项目；SQLite 没有布尔，存 0/1 */
  is_own: number
  category: string
  record: string
  added_at: string
  sort_order: number
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  path: r.path,
  remoteUrl: r.remote_url,
  // SQLite 没有布尔：0/1 存，出去就是 boolean
  isOwn: r.is_own === 1,
  category: r.category,
  record: r.record,
  addedAt: r.added_at,
  sortOrder: r.sort_order,
})

export interface ListProjectsOptions {
  category?: string
  tag?: string
  q?: string
  /** '1' = 只看我自己的项目；'0' = 只看不是自己的；不传 = 都要 */
  own?: '1' | '0'
}

export function listProjects(db: DB, opts: ListProjectsOptions = {}): ProjectListItem[] {
  const where: string[] = []
  const params: Record<string, string> = {}

  if (opts.category) {
    where.push('p.category = @category')
    params['category'] = opts.category
  }
  if (opts.own !== undefined) {
    where.push(`p.is_own = @own`)
    params['own'] = opts.own === '1' ? '1' : '0'
  }
  if (opts.q) {
    // 记录也参与搜索：那里面常写着「怎么找到的」，是找得回一个项目的线索
    where.push('(p.name LIKE @q OR p.record LIKE @q OR p.path LIKE @q OR p.remote_url LIKE @q)')
    params['q'] = `%${opts.q}%`
  }
  if (opts.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
               WHERE pt.project_id = p.id AND t.name = @tag)`,
    )
    params['tag'] = opts.tag
  }

  const rows = db
    .prepare(
      `SELECT p.* FROM projects p
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY CASE WHEN p.category = '' THEN 1 ELSE 0 END,  -- 无分类的排最后
                p.category COLLATE NOCASE, p.sort_order, p.name COLLATE NOCASE`,
    )
    .all(params) as ProjectRow[]

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const tags = tagsByProject(db, ids)
  const checks = latestChecksByProject(db, ids)

  return rows.map((r) => ({
    ...toProject(r),
    tags: tags.get(r.id) ?? [],
    latestCheck: checks.get(r.id) ?? null,
  }))
}

export function getProject(db: DB, id: number): ProjectDetail | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!row) return null
  return {
    ...toProject(row),
    tags: tagsByProject(db, [id]).get(id) ?? [],
    latestCheck: latestChecksByProject(db, [id]).get(id) ?? null,
  }
}

export interface InsertProjectInput {
  name: string
  path: string
  remoteUrl: string | null
  isOwn?: boolean
  category: string
  record: string
  sortOrder?: number
  addedAt?: string
}

export function insertProject(db: DB, input: InsertProjectInput): number {
  const addedAt = input.addedAt ?? new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO projects (name, path, remote_url, category, is_own, record, added_at, sort_order)
       VALUES (@name, @path, @remoteUrl, @category, @isOwn, @record, @addedAt, @sortOrder)`,
    )
    .run({
      name: input.name,
      path: input.path,
      remoteUrl: input.remoteUrl,
      category: input.category,
      isOwn: input.isOwn ? 1 : 0,
      record: input.record,
      addedAt,
      sortOrder: input.sortOrder ?? nextSortOrder(db, input.category),
    })
  return Number(info.lastInsertRowid)
}

export function nextSortOrder(db: DB, category: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM projects WHERE category = ?')
    .get(category) as { max: number }
  return row.max + 10
}

const UPDATABLE = {
  name: 'name',
  path: 'path',
  isOwn: 'is_own',
  category: 'category',
  remoteUrl: 'remote_url',
  record: 'record',
  sortOrder: 'sort_order',
} as const

export function updateProject(db: DB, id: number, patch: Record<string, unknown>): boolean {
  const sets: string[] = []
  const params: Record<string, unknown> = { id }
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (key in patch) {
      sets.push(`${column} = @${key}`)
      // better-sqlite3 不接 boolean（只认 null / number / string / bigint / buffer），
      // 布尔一律在这里换成 0/1。写进去之前不转的话，PATCH isOwn 会直接抛
      // "TypeError: can not bind" —— 而那是个看不出跟「勾选框」有关的报错。
      params[key] = typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key]
    }
  }
  if (sets.length === 0) return false
  const info = db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`).run(params)
  return info.changes > 0
}

export function deleteProject(db: DB, id: number): boolean {
  // 只删 DB 记录，绝不动磁盘上的仓库
  return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
}

/**
 * 这个路径（或它的大小写变体）已经在清单里了吗？
 *
 * 用 `lower(path)` 比较：SQLite 的 `=` 对 TEXT 默认区分大小写，而 NTFS 不区分。
 * 只按原样比较的话，同一个目录能进清单两条 —— 状态会被查两次、DELETE 只删掉
 * 其中一条、扫描又把两条都标成「已在清单里」，自相矛盾。
 * 库层还有一条 `lower(path)` 的部分唯一索引兜底（`001_init` 里那条
 * `idx_projects_path_ci`）。
 */
export function pathExists(db: DB, p: string, exceptId?: number): boolean {
  const row = db
    .prepare('SELECT id FROM projects WHERE lower(path) = lower(?) AND (? IS NULL OR id <> ?)')
    .get(p, exceptId ?? null, exceptId ?? null) as { id: number } | undefined
  return row !== undefined
}

export function tagsByProject(db: DB, ids: number[]): Map<number, Tag[]> {
  const map = new Map<number, Tag[]>()
  if (ids.length === 0) return map
  const rows = db
    .prepare(
      `SELECT pt.project_id AS projectId, t.id, t.name, t.color
       FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.project_id IN (${ids.map(() => '?').join(',')})
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(...ids) as (Tag & { projectId: number })[]
  for (const r of rows) {
    const list = map.get(r.projectId) ?? []
    list.push({ id: r.id, name: r.name, color: r.color })
    map.set(r.projectId, list)
  }
  return map
}

function latestChecksByProject(db: DB, ids: number[]): Map<number, UpdateCheckSummary> {
  const map = new Map<number, UpdateCheckSummary>()
  if (ids.length === 0) return map
  // 只挑「最近一次真正问到远程结论」的那条：fetch 失败的检查、以及
  // 「不是仓库 / 没有远程」这类本地状态都不算问过远程，不能拿来刷新新鲜度
  // ——否则断网后点一次检查，界面反而显示刚确认过的绿色「已是最新」。
  // 过滤条件用 isRemoteCheckStatus 的同一份取值，避免两处漂移。
  const qualified = REMOTE_CHECK_STATUSES.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT project_id AS projectId, checked_at AS checkedAt, status, ahead_count AS aheadCount,
              behind_count AS behindCount, detail
       FROM update_checks WHERE id IN (
         SELECT MAX(id) FROM update_checks
         WHERE project_id IN (${ids.map(() => '?').join(',')}) AND status IN (${qualified})
         GROUP BY project_id
       )`,
    )
    .all(...ids, ...REMOTE_CHECK_STATUSES) as (UpdateCheckSummary & {
    projectId: number
    detail: string | null
  })[]
  for (const r of rows) {
    const { projectId, detail, ...summary } = r
    if (!isRemoteCheckStatus(summary.status)) continue
    // 「推不推荐更新」只在真正检查过的那一刻才产生，所以这里是从历史里**读出来**的，
    // 不是现算的。现算要先 fetch，而列表页是纯本地的——那会拿旧 refs 冒充结论。
    map.set(projectId, { ...summary, recommendation: recommendationFromDetail(detail) })
  }
  return map
}

/**
 * 从 `update_checks.detail` 里取回上次算出的推荐结论。
 *
 * 只存了 `verdict` 这个短码，其余（原因、能不能拉）用 core 的 `recommendationFrom`
 * 重建——**不在 server 里另写一份文案**，那必然与 core 漂开。
 * 旧记录没有 `verdict`（这个字段之前不存在），返回 null：宁可没有，也不要编一条。
 */
function recommendationFromDetail(detail: string | null): UpdateRecommendation | null {
  if (!detail) return null
  try {
    const parsed = JSON.parse(detail) as { verdict?: unknown; canPull?: unknown }
    const verdict = parsed.verdict
    if (typeof verdict !== 'string' || !isVerdict(verdict)) return null
    // canPull 一起存了（光凭 verdict 推不出来：「已是最新」也是 safe，但没东西可拉）
    return recommendationFrom(verdict, parsed.canPull === true)
  } catch {
    return null
  }
}

function isVerdict(value: string): value is UpdateVerdict {
  return Object.hasOwn(VERDICT_LABEL, value)
}
