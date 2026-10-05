import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { VERDICT_LABEL, VERDICT_REASON, type UpdateVerdict } from '@git-nest/core'
import type { DB } from '../db/index.ts'
import { badRequest, notFound } from '../lib/errors.ts'
import {
  analyze,
  clearStatusCache,
  pull,
  type UpdateReport,
} from '../lib/git.ts'
import { readSettings } from '../lib/settings.ts'
import { lastUpstreamSha, lastVerdict, recordUpdateCheck } from '../repos/updates.ts'
import {
  createTask,
  eventsSince,
  failTask,
  finish,
  getTask,
  markDone,
  markFailed,
  markRunning,
  taskSnapshot,
  type Task,
} from '../lib/tasks.ts'

/** 一次最多处理多少个仓库——再多就该先用扫描目录分批了 */
const MAX_BATCH = 200
const SSE_POLL_MS = 150
const SSE_HEARTBEAT_MS = 25_000

const idsSchema = z.object({
  ids: z.array(z.number().int().positive()).max(MAX_BATCH).optional(),
})

const applySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_BATCH),
})

/**
 * 更新模块。核心原则：**绝不自动更新**。
 * 检查可以批量跑，更新必须由用户勾选后触发，且只走 --ff-only。
 */
export const updateRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  /** 批量 fetch + 分析，逐仓库推进度 */
  fastify.post('/updates/check', async (req, reply) => {
    const body = idsSchema.parse(req.body ?? {})
    const settings = readSettings(db)
    const targets = pickTargets(db, body.ids, settings.includePersonal)

    const skipped = describeSkipped(db, body.ids, targets.map((t) => t.id))
    if (targets.length === 0) {
      throw badRequest(
        skipped.length > 0
          ? `选中的项目都属于 personal，没法自动检查（${skipped.length} 个）`
          : '没有可检查的项目',
      )
    }

    const task = createTask(
      'check',
      targets.map((t) => ({ id: t.id, name: t.name })),
    )

    // 后台跑；请求立刻返回，前端拿 id 去订阅 SSE
    void runCheck(db, task, targets).catch((err: unknown) => {
      failTask(task, err instanceof Error ? err.message : '检查失败')
    })

    return reply.code(202).send({ ...taskSnapshot(task), skipped })
  })

  /** 勾选后 ff-only 更新，逐仓库串行 */
  fastify.post('/updates/apply', async (req, reply) => {
    const { ids } = applySchema.parse(req.body ?? {})
    const found = loadTargets(db, ids)
    if (found.length === 0) throw badRequest('这些项目都不在清单里')

    const task = createTask(
      'apply',
      found.map((t) => ({ id: t.id, name: t.name })),
    )
    void runApply(db, task, found).catch((err: unknown) => {
      failTask(task, err instanceof Error ? err.message : '更新失败')
    })

    return reply.code(202).send(taskSnapshot(task))
  })

  /** 一次性拿任务快照（前端也可以只靠 SSE，这个用于断线重连后补状态） */
  fastify.get('/updates/:taskId', async (req) => {
    const { taskId } = req.params as { taskId: string }
    const task = getTask(taskId)
    if (!task) throw notFound('任务')
    return taskSnapshot(task)
  })

  /** 进度流。EventSource 只能 GET，所以启动用 POST、订阅用 GET。 */
  fastify.get('/updates/:taskId/events', async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    const task = getTask(taskId)
    if (!task) throw notFound('任务')

    const lastId = Number(req.headers['last-event-id'] ?? (req.query as { cursor?: string } | undefined)?.cursor ?? 0)
    await streamEvents(reply, task, Number.isFinite(lastId) ? lastId : 0)
  })
}

interface Target {
  id: number
  name: string
  path: string
  category: string
}

function loadTargets(db: DB, ids: number[]): Target[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT id, name, path, category FROM projects
       WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { id: number; name: string; path: string; category: string }[]

  const byId = new Map(rows.map((r) => [r.id, r]))
  // 按请求顺序返回，前端的勾选顺序才有意义
  return ids.map((id) => byId.get(id)).filter((t): t is Target => Boolean(t))
}

function pickTargets(db: DB, ids: number[] | undefined, includePersonal: boolean): Target[] {
  const all = ids ? loadTargets(db, ids) : loadAll(db)
  return includePersonal ? all : all.filter((t) => t.category !== 'personal')
}

function loadAll(db: DB): Target[] {
  return db
    .prepare('SELECT id, name, path, category FROM projects ORDER BY id')
    .all() as Target[]
}

/**
 * 「别拉」的两种判决要给用户一个说得通的理由，并且**禁止执行**。
 *
 * 只有这两种：`rewritten`（作者 force push 改写了历史）与 `unrelated`（作者删库重建）。
 * 它们的表象都是 `behind`（本地 refs 只看到「落后 N 个」），所以必须靠判决拦，
 * 光看状态拦不住。返回 null = 可以照常 pull。
 */
function refuseReason(last: { verdict: UpdateVerdict } | null): string | null {
  if (!last) return null
  if (last.verdict !== 'rewritten' && last.verdict !== 'unrelated') return null
  return `上次检查的结论是「${VERDICT_LABEL[last.verdict]}」：${VERDICT_REASON[last.verdict]}`
}

/** 告诉用户哪些没查、为什么没查——静默跳过最让人困惑。 */
function describeSkipped(db: DB, requested: number[] | undefined, included: number[]): string[] {
  if (!requested) return []
  const all = loadTargets(db, requested)
  const includedSet = new Set(included)
  return all
    .filter((t) => !includedSet.has(t.id))
    .map((t) => `${t.name}（personal）`)
}

async function runCheck(db: DB, task: Task, targets: Target[]) {
  const reports: UpdateReport[] = []

  // 不在这里套 scheduler.map：analyze() 内部已经按仓库排队并限流了，
  // 再包一层会对同一个 path 自锁。但它必须走 lib/git.ts 那一个 scheduler 实例，
  // 否则会落到 core 的 defaultScheduler，「同仓库串行」就失效了（而且并发上限也不受设置控制）。
  await Promise.all(
    targets.map(async (target) => {
      markRunning(task, target.id)
      try {
        // 上次见过的上游 SHA 从历史里读——core 不认识数据库。
        // 没有它，「作者 force push 改写了历史」是判不出来的。
        const report = await analyze(target.path, lastUpstreamSha(db, target.id))
        reports.push(report)
        recordUpdateCheck(db, target.id, report)
        markDone(task, target.id, report)
      } catch (err) {
        const message = err instanceof Error ? err.message : '检查失败'
        markFailed(task, target.id, message)
      }
    }),
  )

  const all = reports
  // 桶要互斥，不然面板上「N 个没法检查」会和其它桶重复计数
  const COUNTED = new Set(['behind', 'diverged', 'up_to_date', 'ahead'])
  finish(task, {
    behind: all.filter((r) => r.status === 'behind').length,
    upToDate: all.filter((r) => r.status === 'up_to_date').length,
    ahead: all.filter((r) => r.status === 'ahead').length,
    diverged: all.filter((r) => r.status === 'diverged').length,
    skipped: all.filter((r) => !COUNTED.has(r.status)).length,
    failed: task.items.filter((i) => i.state === 'failed').length,
  })
  clearStatusCache()
}

async function runApply(db: DB, task: Task, targets: Target[]) {
  const summary = { updated: 0, upToDate: 0, skipped: 0, failed: 0, commits: 0 }

  // 逐个串行：pull 会写工作区，同时拉多个仓库容易互相干扰，也不好看
  for (const target of targets) {
    markRunning(task, target.id)
    try {
      /*
        **服务端也复查一次判决**（前端禁掉勾选只是建议，直接打这个接口绕得过去）。
        判决早就落在 `update_checks.detail` 里，读它不用多跑任何 git 命令。
        这一步拦的是「作者 force push 改写了历史」与「作者删库重建」——
        它们的表象恰恰是 `behind`，只看状态是拦不住的。
      */
      const refuse = refuseReason(lastVerdict(db, target.id))
      if (refuse) {
        markDone(task, target.id, {
          outcome: 'skipped',
          newCommits: 0,
          status: 'diverged',
          reason: refuse,
          error: null,
          summary: `跳过：${refuse}`,
        })
        summary.skipped += 1
        // **不写 update_checks**：这一步没联网、没读到任何新事实。
        // 写一行会把「上次检查」的时间与状态换成一次并没发生过的检查。
        continue
      }

      // 走 lib/git.ts 的 pull()（它带 server 的 scheduler）而不是裸 pullRepo，
      // 否则同一个仓库的 pull 会与状态查询并发
      const result = await pull(target.path)
      recordUpdateCheck(db, target.id, {
        status: result.status,
        ahead: null,
        behind: null,
        incoming: [],
        outgoing: [],
        tags: [],
        // pull 之后不重新算推荐：这一刻真正的答案是「刚刚拉过了」，
        // 下一次检查会给出新的结论。这里给 null 比给一条旧结论诚实。
        recommendation: null,
        upstreamSha: null,
        error: result.error,
      })
      markDone(task, target.id, result)

      if (result.outcome === 'updated') {
        summary.updated += 1
        summary.commits += result.newCommits
      } else if (result.outcome === 'already_up_to_date') summary.upToDate += 1
      else if (result.outcome === 'skipped') summary.skipped += 1
      else summary.failed += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新失败'
      markFailed(task, target.id, message)
      summary.failed += 1
    }
  }

  finish(task, summary)
  clearStatusCache()
}

async function streamEvents(reply: FastifyReply, task: Task, startCursor: number) {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  let cursor = startCursor
  let lastBeat = Date.now()
  // 客户端断开（关标签页 / 断网 / 代理掐断）时把这个置上，循环立刻退出。
  // 没有它的话，这个 150ms 的轮询会一直空转到任务结束——白烧 CPU，
  // 而且 Ctrl-C 关服务时 Fastify 要等这条永不结束的「活跃请求」，
  // 进程迟迟退不掉。
  let clientGone = false
  const onClose = () => {
    clientGone = true
  }
  reply.raw.on('close', onClose)

  try {
    while (!clientGone) {
      const { events, cursor: next } = eventsSince(task, cursor)
      cursor = next
      for (const payload of events) reply.raw.write(`data: ${payload}\n\n`)

      if (task.status !== 'running') {
        // 收尾时把剩下的一次性刷出去
        const tail = eventsSince(task, cursor)
        for (const payload of tail.events) reply.raw.write(`data: ${payload}\n\n`)
        reply.raw.write('data: {"type":"closed"}\n\n')
        reply.raw.end()
        return
      }

      if (Date.now() - lastBeat > SSE_HEARTBEAT_MS) {
        lastBeat = Date.now()
        reply.raw.write(': ping\n\n') // 心跳，防中间代理掐断
      }

      await sleep(SSE_POLL_MS)
    }
  } catch {
    // 客户端断开：正常路径，不是错误
  } finally {
    reply.raw.off('close', onClose)
    if (!reply.raw.writableEnded) reply.raw.end()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
