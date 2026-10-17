import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { MAX_BATCH_IDS, VERDICT_LABEL, VERDICT_REASON, type UpdateVerdict } from '@git-nest/core'
import type { DB } from '../db/index.ts'
import { badRequest, notFound } from '../lib/errors.ts'
import {
  analyze,
  clearStatusCache,
  pull,
  type UpdateReport,
} from '../lib/git.ts'
import { readSettings } from '../lib/settings.ts'
import { corsHeadersFor } from '../lib/origins.ts'
import {
  lastUpstreamSha,
  lastVerdict,
  pruneUpdateChecks,
  recordUpdateCheck,
} from '../repos/updates.ts'
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

/**
 * 一次批量检查 / 更新最多几个仓库。
 *
 * 数字在 core 的 `limits.ts`：**前端也读它**（超过就在界面上说清「一次最多 N 个，
 * 先勾选一部分或收窄筛选」，而不是等一个 422「参数有误」）。原来是 server 这边
 * 一个私有常量，前端不知道，于是超限时用户只看到一句看不懂的错。
 *
 * 它不等于「能力上限」：check / apply 是后台任务 + SSE 进度 + 确认阈值，
 * 本来就为处理很多个设计的；这个数只是别让「随手一次点击」把整个清单都卷进去。
 */
const MAX_BATCH = MAX_BATCH_IDS
const SSE_POLL_MS = 150
/**
 * 心跳间隔。**必须发 `data:` 帧，不能发 `: ping` 注释帧**：
 * 注释帧是给中间代理和 EventSource 自己的重连机制看的，浏览器的 `message` 事件
 * 不会派发它，而前端的看门狗（`features/updates/taskStream.ts` 的
 * `SILENCE_TIMEOUT_MS`）只认消息帧——一个仓库的 fetch 慢过 75 秒就会被误判成
 * 「流死了」，然后扔掉一条好好的流。所以这里推一个没有状态语义的 `tick`。
 *
 * 它**不进任务的事件缓冲**（见下面 `streamEvents`）：心跳是传输层的事，
 * 不该被重连重放，也不该让缓冲随任务时长一起长。
 */
const SSE_HEARTBEAT_MS = 25_000
const SSE_TICK = '{"type":"tick"}'
/** 任务没了（服务端重启 / 被清扫）时推给客户端的那句话 */
const TASK_GONE_MESSAGE = '这次检查的任务已经不在了（服务端重启过？）。点「重新检查」重跑一次。'

const idsSchema = z.object({
  ids: z.array(z.number().int().positive()).max(MAX_BATCH).optional(),
  /**
   * **显式覆盖**设置里那条「自己的项目也参与检查」。
   *
   * 为什么需要它、而不是拿「带没带 ids」当判据：**批量那次请求也是带 ids 的**
   * （前端把全部目标塞进 `ids`，见 `UpdatePanel` 的注释），所以「带了 ids 就不套用
   * 批量默认」会顺手把批量的「跳过自己的」一起废掉。要不要跳过只有调用方知道：
   * 详情页对单个项目点检查是用户显式点名（传 true），批量面板照旧读设置（不传）。
   */
  includeOwn: z.boolean().optional(),
})

const applySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_BATCH),
})

/**
 * 更新模块。核心原则：**绝不自动更新**。
 * 检查可以批量跑，更新必须由用户勾选后触发，且只走 --ff-only。
 */
export const updateRoutes = (
  db: DB,
  /** `heartbeatMs` 只给测试用：25 秒的心跳没法在用例里等 */
  options: { heartbeatMs?: number } = {},
): FastifyPluginAsync => async (fastify) => {
  const heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS

  /** 批量 fetch + 分析，逐仓库推进度 */
  fastify.post('/updates/check', async (req, reply) => {
    const body = idsSchema.parse(req.body ?? {})
    const settings = readSettings(db)
    // 显式覆盖优先；没传就照旧读设置——批量面板不传，所以它仍然按设置跳过自己的项目
    const targets = pickTargets(db, body.ids, body.includeOwn ?? settings.includeOwn)

    const skipped = describeSkipped(db, body.ids, targets.map((t) => t.id))
    if (targets.length === 0) {
      throw badRequest(
        skipped.length > 0
          ? `选中的项目都是你自己写的，没法自动检查（${skipped.length} 个）`
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

  /**
   * 进度流。EventSource 只能 GET，所以启动用 POST、订阅用 GET。
   *
   * **任务不存在时故意不回 404**：`EventSource` 读不到状态码，非 2xx 只会让它触发
   * 一次 `onerror`，前端分不清「服务端重启把内存里的任务丢了」和「网络抖了一下」，
   * 于是照原计划重连 3 次、再报「重连几次都没成功」——而那 3 次注定不会成功。
   * 这里改成一条**正常收尾**的流，把原因当作 `error` 事件推过去，面板直接显示
   * 「任务已经不在了，重新检查一次」。
   * （快照接口 `GET /updates/:taskId` 仍然回 404 —— 那是给普通 HTTP 调用方的。）
   */
  fastify.get('/updates/:taskId/events', async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    const task = getTask(taskId)
    if (!task) {
      await sendTaskGone(req.headers.origin, reply)
      return
    }

    const lastId = Number(req.headers['last-event-id'] ?? (req.query as { cursor?: string } | undefined)?.cursor ?? 0)
    await streamEvents(
      req.headers.origin,
      reply,
      task,
      Number.isFinite(lastId) ? lastId : 0,
      heartbeatMs,
    )
  })
}

interface Target {
  id: number
  name: string
  path: string
  /** 是不是我自己写的项目（SQLite 没有布尔，存 0/1） */
  isOwn: number
}

function loadTargets(db: DB, ids: number[]): Target[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT id, name, path, is_own AS isOwn FROM projects
       WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { id: number; name: string; path: string; isOwn: number }[]

  const byId = new Map(rows.map((r) => [r.id, r]))
  // 按请求顺序返回，前端的勾选顺序才有意义
  return ids.map((id) => byId.get(id)).filter((t): t is Target => Boolean(t))
}

/**
 * 这一轮检查打哪些项目。
 *
 * **判据是 `is_own` 这个布尔，不是「分类等于 personal」**——后者是一条挂在
 * 自由文本上的隐藏规则：写成 `Personal` 或多打一个空格就静默失效，界面上没有
 * 任何提示。自己的项目自己清楚，所以默认跳过；要在批量里带上，设置里打开
 * 「自己的项目也参与检查」。
 */
function pickTargets(db: DB, ids: number[] | undefined, includeOwn: boolean): Target[] {
  const all = ids ? loadTargets(db, ids) : loadAll(db)
  return includeOwn ? all : all.filter((t) => !t.isOwn)
}

function loadAll(db: DB): Target[] {
  return db
    .prepare('SELECT id, name, path, is_own AS isOwn FROM projects ORDER BY id')
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
    .map((t) => `${t.name}（我自己的）`)
}

async function runCheck(db: DB, task: Task, targets: Target[]) {
  const reports: UpdateReport[] = []

  // 不在这里套 scheduler.map：analyze() 内部已经按仓库排队并限流了，
  // 再包一层会对同一个 path 自锁。但它必须走 lib/git.ts 那一个 scheduler 实例，
  // 否则会落到 core 的 defaultScheduler，「同仓库串行」就失效了（而且并发上限也不受设置控制）。
  await Promise.all(
    targets.map(async (target) => {
      try {
        // 上次见过的上游 SHA 从历史里读——core 不认识数据库。
        // 没有它，「作者 force push 改写了历史」是判不出来的。
        //
        // `onStart` 而不是在这里 markRunning：`analyze` 内部按仓库排队限流，
        // 这一句会在**所有** target 上同步执行——200 个仓库会一起变成「检查中」，
        // 而真正在跑的只有并发上限那几个。进度条上的数字会骗人。
        const report = await analyze(target.path, {
          lastUpstreamSha: lastUpstreamSha(db, target.id),
          onStart: () => markRunning(task, target.id),
          // 按项目换传输方式：上次走通的那条先试，这次走通的记下来
          projectId: target.id,
        })
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
  // 历史只被用来「读最近一个事实」，给表加个上限（否则它会一直长）
  pruneUpdateChecks(db)
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
      // 否则同一个仓库的 pull 会与状态查询并发。
      //
      // 第二个参数是**基线**：上面那道闸读的是「上次检查的结论」，而检查到点更新
      // 之间作者可能刚好 force push——那种情况本地 HEAD 仍是新历史的祖先，
      // `pull --ff-only` 会安静快进。基线交给 pull：它先 fetch（只动 refs/remotes/*）、
      // 比对、确认没被改写才动工作区。
      //
      // 第三个参数是项目 id：基线闸那次 fetch 也要按项目换传输方式，
      // 走通的那条同样要记住（与「检查」共用一处口径，见 lib/git.ts）。
      const result = await pull(target.path, lastUpstreamSha(db, target.id), target.id)
      /*
        **`skipped` 不写 update_checks**，与上面那道拒绝闸同一条理由（看 `continue` 上面
        那两行注释）。这里曾经无条件写，于是 `PullResult.status` 这个**闸门原因**被当成
        了「远程结论」落库，两个后果都是实打实的：

        1. `SKIP(..., 'ahead' | 'diverged')` 里的值属于 `REMOTE_CHECK_STATUSES`
           （`packages/core/src/types.ts`），所以这一行会被当成「最近一次**合格**检查」，
           把 ahead/behind 覆盖成 null、推荐覆盖成 null → 清单上「上次检查 = 刚刚」
           却显示「待检查」（`ATTENTION_SQL` 没有 ELSE，落 `unchecked`）。
        2. 这一行的 detail 里没有 `upstreamSha`，而 `lastUpstreamSha` 只读最新一行的
           detail → 基线和它一起被清空，下一次检查就判不出「作者改写了历史」。

        换句话说：一次**没动工作区、也没得出远程结论**的跳过，不该出现在「检查历史」里。
        `failed` 照写——失败归因本来就要留档，而它不在那四个「合格」状态里。
      */
      if (result.outcome !== 'skipped') {
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
      }
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
  pruneUpdateChecks(db)
}

/**
 * 把进度推成一条 SSE 流。
 *
 * `origin` 是浏览器带的 `Origin`，用来自己补 CORS 头——**这一步不能省**：
 * 头部是直接写在 `reply.raw` 上的，等于绕开了 Fastify 的发送通道，`@fastify/cors`
 * 在钩子里设的头一个都到不了线上。后果只在**跨源**时才现形：浏览器里开发走 vite
 * 代理（同源）一切正常，而桌面壳里页面的来源是 `http://tauri.localhost`（dev 形态
 * 是 web 端口那个来源）、API 在 `127.0.0.1:36379`，跨源且响应里没有
 * `access-control-allow-origin` → 浏览器直接判这条连接失败 → 客户端四次
 * `onerror` 之后报「进度流断了，重连几次都没成功」，而同一页面的其它接口全好。
 */
async function streamEvents(
  origin: string | undefined,
  reply: FastifyReply,
  task: Task,
  startCursor: number,
  heartbeatMs: number,
) {
  reply.raw.writeHead(200, sseHeaders(origin))

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

      if (Date.now() - lastBeat > heartbeatMs) {
        lastBeat = Date.now()
        // 心跳写成事件而不是 `: ping`：注释帧不派发 message，前端看门狗看不见
        // （见上面 `SSE_HEARTBEAT_MS` 那段）。顺带它也替代理保了活。
        reply.raw.write(`data: ${SSE_TICK}\n\n`)
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

/**
 * 任务没了：给一条**正常收尾**的流，把原因当 `error` 事件说清楚。
 *
 * 为什么不回 404：见上面路由那段注释（`EventSource` 读不到状态码，404 在客户端
 * 眼里和断网一模一样，只会换来三次注定失败的重连）。
 */
async function sendTaskGone(origin: string | undefined, reply: FastifyReply) {
  reply.raw.writeHead(200, sseHeaders(origin))
  reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: TASK_GONE_MESSAGE })}\n\n`)
  reply.raw.write('data: {"type":"closed"}\n\n')
  reply.raw.end()
}

/**
 * SSE 的响应头。**头部是直接写给 `reply.raw` 的**，绕开了 Fastify 的发送通道，
 * 所以 `@fastify/cors` 设的头到不了线上——CORS 头必须按同一份白名单自己补，
 * 否则跨源的 `EventSource` 会被浏览器直接判失败（理由见 `streamEvents` 的注释）。
 */
function sseHeaders(origin: string | undefined): Record<string, string> {
  return {
    ...corsHeadersFor(origin),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
