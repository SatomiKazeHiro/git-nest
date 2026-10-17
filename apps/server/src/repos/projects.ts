import type { DB } from '../db/index.ts'
import { readRepoStates } from './repo-state.ts'
import {
  DEFAULT_SORT_DIR,
  ATTENTION_RANK,
  GIT_ERROR_KINDS as CORE_GIT_ERROR_KINDS,
  isRemoteCheckStatus,
  recommendationFrom,
  type Attention,
  type ProjectSort,
  type SortDir,
  type Project,
  type ProjectDetail,
  type ProjectListItem,
  type LastUpdateAttempt,
  type Tag,
  type GitError,
  type GitErrorKind,
  type UpdateCheckSummary,
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

/** 带上了 `attention` 的行（下面 ATTENTION_SQL 的别名） */
type ProjectRowWithAttention = ProjectRow & { attention: Attention }

/**
 * 逐项目带出**当前状态**那一行（`repo_state`，别名 c）。
 *
 * 一个项目一行，没有就是「没同步过」——不再需要「从流水里挑最新一次合格检查」
 * 那种相关子查询。CORS 那次教训之后留一句：**这一个是主体表**，
 * 见 `docs/软件定位.md` §3。
 */
const STATE_JOIN = `LEFT JOIN repo_state c ON c.project_id = p.id`

/**
 * `attention` 的判定。读 `repo_state` 的列（不再是 `detail` 里的 JSON）。
 *
 * 判据一个字没改，只是数据来源从「历史里挑一条再解 JSON」变成「读这一行」：
 * - `verdict` 属于「别拉」两种 → blocked；`diverged` → decide；
 * - `can_pull = 1` → ready（**不能**用 `behind > 0` 代替：「已是最新」也是 safe，
 *   但没有东西可拉）；
 * - 其余（含「只失败过、没有结论」的行）→ unchecked。
 *
 * **这里的服务端实现是唯一一份**：列表显示、状态筛选、侧栏计数三处都用它，
 * 前端出现任何「按 verdict 判断该显示什么分类」的代码都是 bug。
 */
const ATTENTION_SQL = `
  CASE
    WHEN c.project_id IS NULL THEN 'unchecked'
    WHEN c.verdict IN ('rewritten', 'unrelated') THEN 'blocked'
    WHEN c.verdict = 'diverged' THEN 'decide'
    WHEN c.can_pull = 1 THEN 'ready'
    WHEN c.verdict = 'safe' THEN 'synced'
    ELSE 'unchecked'
  END
`

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

 interface ListProjectsOptions {
  category?: string
  tag?: string
  q?: string
  /** '1' = 只看我自己的项目；'0' = 只看不是自己的；不传 = 都要 */
  own?: '1' | '0'
  /** 行动分类筛选；多个之间是「或」。与其它维度叠加。 */
  attention?: Attention[]
  /** 列表排序。默认按 分类 → sort_order → 名称 */
  sort?: ProjectSort
  /** 排序方向；不传用 `DEFAULT_SORT_DIR` 里该键的默认方向（与加这个参数之前一致） */
  dir?: SortDir
}

export function listProjects(db: DB, opts: ListProjectsOptions = {}): ProjectListItem[] {
  const where: string[] = []
  const params: Record<string, string> = {}

  // `!== undefined` 而不是真值判断：**空串是一个合法的筛选值**（「只看没有分类的
  // 那些」）。用真值判断的话 category='' 会被当成「没这个筛选」而整段跳过，
  // 于是侧栏里「未分类」那一项看起来能点、点了却等于没筛——另一种死控件。
  if (opts.category !== undefined) {
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

  if (opts.attention && opts.attention.length > 0) {
    /*
      **表达式内联、值绑参**，两者不能互换：SQL 参数装的是「值」，把整个 CASE
      当参数绑进去的话，比的是那段 SQL 文本，永远不相等（写错过一次，被测试抓出来）。

      内联的是我们自己写的 `ATTENTION_SQL`，不是用户输入；用户来的分类名一律
      走 `@att0` 这种具名参数。
    */
    const marks = opts.attention.map((_, i) => `@att${i}`)
    for (const [i, a] of opts.attention.entries()) params[`att${i}`] = a
    where.push(`(${ATTENTION_SQL}) IN (${marks.join(', ')})`)
  }

  const orderBy = (() => {
    /*
      方向只翻**值那一列**。`没查过的排最后` 那条 CASE **不跟着翻**：它表达的是
      「这个项目没有可排的值」，不是一个小/大的值——升序时把它翻到最前面，等于
      用「没数据」压住了真正落后最多的仓库。
    */
    const dirOf = (key: ProjectSort): 'ASC' | 'DESC' =>
      (opts.dir ?? DEFAULT_SORT_DIR[key]) === 'asc' ? 'ASC' : 'DESC'

    switch (opts.sort) {
      case 'attention': {
        /*
          **行动优先**：能动手的排最前，没事的排最后。

          1. 可更新 —— 唯一「现在就该动手」的一类
          2. 不推荐 —— 作者改写过历史 / 换了仓库，要人看一眼才知道怎么办
          3. 需要确认 —— 分叉，得人决定
          4. 待检查 —— 还没问过远程，该去问一次
          5. 已同步 —— 没事，垫底

          次序只写在这一处（就是这几个数字），要调就调它们。
          同一个序号里按名称排：它们会**并列**（一堆「已同步」），不给定序的话
          SQLite 每次给的顺序都可能不同，滚动时行会自己换位置。
        */
        /*
          **次序由 core 的 `ATTENTION_RANK` 生成**，不再在这里手写一遍：
          这条 SQL 里出现的短码只剩判定那一次（`ATTENTION_SQL`），排序跟着它走。

          没有 `ELSE`：`ATTENTION_RANK` 恰好覆盖所有取值，而 `attention-rank.test.ts`
          钉着「一个不多、一个不少」——真漏了，那条测试会红，而不是这里静默把它排到最后。
        */
        const rank = `CASE (${ATTENTION_SQL}) ${ATTENTION_RANK.map(
          (a, i) => `WHEN '${a}' THEN ${i}`,
        ).join(' ')} END`
        // 并列时也按名称，**方向跟着主键**：否则降序时前半段翻了、并列那一段没翻，
        // 看着像没排干净
        const by = dirOf('attention')
        return `${rank} ${by}, p.name COLLATE NOCASE ${by}`
      }
      case 'checked':
        // 没查过的排最后：它们没有「上次检查」这个值可排
        return `CASE WHEN c.project_id IS NULL THEN 1 ELSE 0 END, c.checked_at ${dirOf('checked')}`
      case 'behind':
        return `CASE WHEN c.project_id IS NULL THEN 1 ELSE 0 END, c.behind ${dirOf('behind')}`
      case 'name':
        // 纯名称序。**不能并进 default** —— default 是「先按分类分组，同类再按
        // sort_order」；用户既然在排序下拉里点了「按名称」，要的就是名称序，
        // 不是分类分组序（第一次写错了，是这条测试抓出来的）。
        return `p.name COLLATE NOCASE ${dirOf('name')}`
      default:
        return `CASE WHEN p.category = '' THEN 1 ELSE 0 END,  -- 无分类的排最后
                p.category COLLATE NOCASE, p.sort_order, p.name COLLATE NOCASE`
    }
  })()

  const rows = db
    .prepare(
      `SELECT p.*, ${ATTENTION_SQL} AS attention FROM projects p
       ${STATE_JOIN}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${orderBy}`,
    )
    .all(params) as ProjectRowWithAttention[]

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const tags = tagsByProject(db, ids)
  const checks = latestChecksByProject(db, ids)
  const attempts = lastAttemptsByProject(db, ids)

  return rows.map((r) => ({
    ...toProject(r),
    tags: tags.get(r.id) ?? [],
    latestCheck: checks.get(r.id) ?? null,
    lastAttempt: attempts.get(r.id) ?? null,
    attention: r.attention,
    // 这一层不碰磁盘：logo 与类型都是路由那一层扫出来的结论。不知道就说不知道。
    hasLogo: false,
    projectType: null,
  }))
}

export function getProject(db: DB, id: number): ProjectDetail | null {
  // 详情栏那个药丸读的是同一份 attention，所以这里也得带同一段 SQL
  const row = db
    .prepare(
      `SELECT p.*, ${ATTENTION_SQL} AS attention FROM projects p
       ${STATE_JOIN}
       WHERE p.id = @id`,
    )
    .get({ id }) as ProjectRowWithAttention | undefined
  if (!row) return null
  return {
    ...toProject(row),
    tags: tagsByProject(db, [id]).get(id) ?? [],
    latestCheck: latestChecksByProject(db, [id]).get(id) ?? null,
    lastAttempt: lastAttemptsByProject(db, [id]).get(id) ?? null,
    attention: row.attention,
    hasLogo: false,
    projectType: null,
  }
}

 interface InsertProjectInput {
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

 function tagsByProject(db: DB, ids: number[]): Map<number, Tag[]> {
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

/**
 * 「上次检查」这一列读什么：`repo_state` 里那次**合格**同步。
 *
 * **仍然要过滤状态**，理由与改造前一模一样：一次 fetch 失败的尝试只写
 * `attempt_at`/`error`，不该刷新新鲜度——否则断网后点一次检查，界面反而显示
 * 刚确认过的绿色「已是最新」。过滤取值来自 `REMOTE_CHECK_STATUSES`，与
 * `writeRepoState` 判「合格」用的是同一份常量。
 */
function latestChecksByProject(db: DB, ids: number[]): Map<number, UpdateCheckSummary> {
  const map = new Map<number, UpdateCheckSummary>()
  if (ids.length === 0) return map

  const rows = readRepoStates(db, ids)
  for (const [projectId, state] of rows) {
    // 只失败过、还没成功过的仓库：没有合格结论，这一格就该是「没查过」
    if (!isRemoteCheckStatus(state.status)) continue
    map.set(projectId, {
      checkedAt: state.checkedAt,
      status: state.status,
      aheadCount: state.ahead,
      behindCount: state.behind,
      // 「推不推荐更新」是那次同步算出来的结论，这里**重建**，不重算：
      // 现算要先 fetch，而列表页是纯本地的——那会拿旧 refs 冒充结论。
      recommendation:
        state.verdict === null ? null : recommendationFrom(state.verdict, state.canPull),
      // 行内只显示这几条；总数是 behindCount（它没有被截断）
      incoming: state.incoming.map((c) => ({ shortHash: c.shortHash, subject: c.subject })),
    })
  }
  return map
}

/**
 * 每个项目**最近一次尝试**（成功或失败）：失败的话为什么。
 *
 * **不能拿它顶替 `latestChecksByProject`**，两者回答两个问题：上面那个只认真的
 * 问到过远程结论的那次（新鲜度用它），这一个要的正是被过滤掉的失败——用户遇到过
 * 的真实困惑是「一边说 42 分钟前落后 631、一边检查什么都不给」。
 */
function lastAttemptsByProject(db: DB, ids: number[]): Map<number, LastUpdateAttempt> {
  const map = new Map<number, LastUpdateAttempt>()
  if (ids.length === 0) return map

  for (const [projectId, state] of readRepoStates(db, ids)) {
    map.set(projectId, {
      at: state.attemptAt,
      status: state.attemptStatus,
      error: errorFromStored(state.error),
    })
  }
  return map
}

/**
 * core 的 `GitErrorKind` 取值。用来挡住库里那些不是 `GitError` 的东西。
 *
 * **直接由 core 的权威数组生成**，不在这里另抄九个字面量：手抄的那份在 core
 * 加一个 kind 之后会静默落后，于是新 kind 的旧记录被判成「没有原因」，
 * 界面只说「没有原因」。`git-error-vocabulary` 那条用例钉着两边相等。
 */
const GIT_ERROR_KINDS = new Set<string>(CORE_GIT_ERROR_KINDS)

/**
 * 从 `repo_state.error` 里取回这次尝试的失败原因。
 *
 * 守卫是必要的，不是防自己的写入：列里存的是 `GitError` 的 JSON，但早期记录里
 * 可能只有 `{ kind: 'network' }`（没有 `message`）——那读出来就是一条没有内容的
 * 警示。**宁可说「没有原因」，也不要往界面塞半条**。
 */
function errorFromStored(stored: string | null): GitError | null {
  if (!stored) return null
  try {
    const error = JSON.parse(stored) as unknown
    if (typeof error !== 'object' || error === null) return null
    const { kind, message, raw } = error as { kind?: unknown; message?: unknown; raw?: unknown }
    if (typeof kind !== 'string' || !GIT_ERROR_KINDS.has(kind)) return null
    if (typeof message !== 'string' || message.length === 0) return null
    return {
      kind: kind as GitErrorKind,
      message,
      ...(typeof raw === 'string' && raw.length > 0 ? { raw } : {}),
    }
  } catch {
    return null
  }
}
