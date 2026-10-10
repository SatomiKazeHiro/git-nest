import type { FastifyPluginAsync } from 'fastify'
import { MAX_STATUS_IDS, idParamSchema, type RepoStatus } from '@git-nest/core'
import type { DB } from '../db/index.ts'
import { repoFacts, repoLog, repoStatus, repoStatusesLean, readReadme, README_MAX_BYTES, README_FULL_MAX_BYTES } from '../lib/git.ts'
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
    /*
      上限与前端分块用的是**同一个常量**（core 的 limits.ts）：前端按它切片，
      所以正常路径永远碰不到这一条。留着是给直接打接口的人一个明确的边界——
      原来前端不知道这个数，超过 200 个项目时整列状态会静默变成「读状态…」。
    */
    if (ids.length > MAX_STATUS_IDS) {
      throw badRequest(`一次最多查 ${MAX_STATUS_IDS} 个仓库`)
    }

    const paths = loadPaths(db, ids)
    const statuses = await repoStatusesLean(paths)
    return { statuses: byId(ids, paths, statuses) }
  })

  fastify.get('/projects/:id/status', async (req) => {
    const { id } = req.params as { id: string }
    const query = (req.query ?? {}) as { fresh?: string }
    const projectId = idParamSchema.parse(id)
    const path = requirePath(db, projectId)
    return {
      status: await repoStatus(path, { fresh: query.fresh === 'true', projectId }),
    }
  })

  /**
   * 当前检出分支的提交记录。
   *
   * **一阶段界面上不再有提交图**（那是个上千节点的 HTML 网格，为 120 条提交
   * 渲染出成百上千个按钮），但这个接口留着：它是「读提交历史」这个能力的
   * 唯一出口，二阶段的 Agent 要解析/学习仓库时直接用得上，而且它已经
   * 被测试覆盖着。留着不等于要显示。
   */
  fastify.get('/projects/:id/log', async (req) => {
    const { id } = req.params as { id: string }
    const path = requirePath(db, idParamSchema.parse(id))

    // 只要「是不是仓库」与「当前分支」两条事实：走库读 .git 就够（0 条 git 进程）。
    // 原来这里跑的是 full + fresh 档的完整状态读取（3–4 条进程，还绕开缓存），
    // 而它读回来的工作区、最后提交、推荐判决一个都没用上。
    const facts = await repoFacts(path)
    if (facts.error) {
      throw badRequest(
        facts.error.kind === 'missing'
          ? '目录不在了，读不到提交记录'
          : '这个目录不是 git 仓库，读不到提交记录',
      )
    }

    const query = (req.query ?? {}) as { max?: string }
    const requested = Number(query.max)
    const max = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 1000) : 200

    const branch = facts.branch ?? 'HEAD'
    // 「空仓库」要返回空列表，而「读不出来」要报出去——这个区分在 core 的 getLog 里
    // （它自己会判 HEAD 解不解得出来）。所以失败不能再被压成空列表。
    try {
      return { entries: await repoLog(path, max, branch), branch }
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : '读不到提交记录')
    }
  })

  /**
   * README 全文。
   *
   * `?full=1` 是界面上「加载完整文档」那一下：上限从 64KB 抬到 256KB
   * （实测：1MB 要 17 秒渲染，那不是「加载」，那是界面卡死）。
   *
   * **「没有 README」是 200 + `file: null`**，不是错误——很多仓库本来就没有说明，
   * 那是正常状态。而「目录没了 / 不是仓库」是 400：那是界面必须说出来的异常。
   * 两者混成同一个结果的话，用户会在项目已经不在了的时候读到「它没有 README」。
   * 判据与 `/log` 完全一致（都走 `repoFacts`，一条 git 进程都不起）。
   *
   * 上限来自 core 的 `limits.ts`，**web 端读的是同一个常量**——否则 web 端
   * 不知道这个天花板，就会给出一个点了也没用的按钮。
   */
  fastify.get('/projects/:id/readme', async (req) => {
    const { id } = req.params as { id: string }
    const path = requirePath(db, idParamSchema.parse(id))

    const facts = await repoFacts(path)
    if (facts.error) {
      throw badRequest(
        facts.error.kind === 'missing'
          ? '目录不在了，读不到 README'
          : '这个目录不是 git 仓库，读不到 README',
      )
    }

    const query = (req.query ?? {}) as { full?: string }
    const maxBytes = query.full === '1' ? README_FULL_MAX_BYTES : README_MAX_BYTES
    return readReadme(path, { maxBytes })
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
    dirtyTracked: 0,
    dirtyUntracked: 0,
    upstream: null,
    upstreamGone: false,
    ahead: null,
    behind: null,
    remoteUrl: null,
    lastCommit: null,
    recommendation: null,
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
