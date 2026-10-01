import type { FastifyPluginAsync } from 'fastify'
import { idParamSchema, type RepoStatus } from '@git-nest/core'
import type { DB } from '../db/index.ts'
import { repoLog, repoStatus, repoStatusesLean } from '../lib/git.ts'
import { badRequest, notFound } from '../lib/errors.ts'

/**
 * git 相关接口。状态一律现查（带几秒短缓存），不落库——
 * 落库的下次打开就是旧数据，反而更危险。
 */
export const gitRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  /**
   * 批量状态：列表页一次拿全部，省得十几个请求。
   *
   * 走 **lean 档**：列表页不显示未提交改动、也不显示最后提交（`StatusCell` 那两处
   * 只有详情页用），而这两条恰好是最贵的（一个要遍历工作区，一个要读对象）。
   * 返回的 `dirty` 恒为 false、`lastCommit` 恒为 null，**不要**据此判安全性——
   * 单仓库接口 `/projects/:id/status` 是 full 档，那才是可信的。
   */
  fastify.get('/status', async (req) => {
    const query = (req.query ?? {}) as { ids?: string }
    const ids = (query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => idParamSchema.safeParse(s))
      .map((r) => (r.success ? r.data : null))
      .filter((n): n is number => n !== null)

    if (ids.length === 0) return { statuses: [] }
    if (ids.length > 200) throw badRequest('一次最多查 200 个仓库')

    const paths = loadPaths(db, ids)
    const statuses = await repoStatusesLean(paths)
    return { statuses: byId(ids, paths, statuses) }
  })

  fastify.get('/projects/:id/status', async (req) => {
    const { id } = req.params as { id: string }
    const query = (req.query ?? {}) as { fresh?: string }
    const path = requirePath(db, idParamSchema.parse(id))
    return { status: await repoStatus(path, { fresh: query.fresh === 'true' }) }
  })

  fastify.get('/projects/:id/log', async (req) => {
    const { id } = req.params as { id: string }
    const path = requirePath(db, idParamSchema.parse(id))

    // 目录没了 / 不是仓库时要说清楚，不能让前端显示成「还没有提交」
    const status = await repoStatus(path, { fresh: true })
    if (!status.isRepo) {
      throw badRequest(
        status.status === 'missing'
          ? '目录不在了，读不到提交记录'
          : '这个目录不是 git 仓库，读不到提交记录',
      )
    }

    const query = (req.query ?? {}) as { max?: string }
    const requested = Number(query.max)
    const max = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 1000) : 200

    // 提交图看的是当前检出分支那条线（不取 --all）：图组件按 branch 组织，
    // 混入别的分支会让提交的分支归属说不清。detached 时退回 HEAD。
    const branch = status.branch ?? 'HEAD'
    return { entries: await repoLog(path, max, branch), branch }
  })
}

function loadPaths(db: DB, ids: number[]): string[] {
  const rows = db
    .prepare(
      `SELECT id, path FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { id: number; path: string }[]
  const byIdMap = new Map(rows.map((r) => [r.id, r.path]))
  // 请求里没给全的 id 也要占位，否则前端对不上号
  return ids.map((id) => byIdMap.get(id) ?? '')
}

function byId(
  ids: number[],
  paths: string[],
  statuses: Awaited<ReturnType<typeof repoStatusesLean>>,
) {
  const statusByPath = new Map(statuses.map((s) => [s.path, s]))
  return ids.map((id, index) => {
    const path = paths[index] ?? ''
    return { projectId: id, status: statusByPath.get(path) ?? missingStatus(path) }
  })
}

function missingStatus(path: string): RepoStatus {
  return {
    path,
    checkedAt: new Date().toISOString(),
    isRepo: false,
    branch: null,
    detached: false,
    dirty: false,
    dirtyCount: 0,
    upstream: null,
    upstreamGone: false,
    ahead: null,
    behind: null,
    remoteUrl: null,
    lastCommit: null,
    status: 'missing',
    error: { kind: 'missing', message: '清单里没有这个项目' },
  }
}

function requirePath(db: DB, id: number): string {
  const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(id) as
    | { path: string }
    | undefined
  if (!row) throw notFound('项目')
  return row.path
}
