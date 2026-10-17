import type { DB } from '../db/index.ts'
import { readSettings } from './settings.ts'
import { syncRepo } from './sync.ts'
import { pruneUpdateChecks } from '../repos/updates.ts'

/**
 * 自动 fetch —— **保持远程状态新鲜，但绝不碰工作区**。
 *
 * 为什么要有它：这个软件「只在点检查时才联网」，后果是新加的仓库在你手动检查前
 * 推荐列一直是空的（推荐的判据必须先问过远程、并且需要一次检查来建立基线）。
 * 用户明确要求自动做这件事。
 *
 * **它动的只有 `refs/remotes/*`**：
 * - 不 pull、不快进、不写工作区——「绝不自动更新」那条不变量仍然成立
 * - 走 server 那一个 `Scheduler` 实例，所以同一个仓库不会和别的操作并发；
 *   跨仓库的并发上限就是设置页那个值（不再是自己一条条串行）
 * - 完全复用 `analyzeUpdates`（含错误归因），所以失败会照常记进 `update_checks`，
 *   和手动检查留下一样的痕迹
 *
 * **每次执行都记进命令日志**（`runner.ts` 的 `recentCommands`，label = `auto-fetch`）：
 * 一个会自己联网的程序，必须让人查得到它到底跑了什么。
 */

/** 首次等一会儿再跑：刚启动时先让页面加载、索引之类的事情做完 */
const FIRST_DELAY_MS = 30_000
/** 之后每隔这么久跑一轮 */
const INTERVAL_MS = 30 * 60_000

let timer: NodeJS.Timeout | null = null
/** 正在进行的那一轮。定时器与手动触发共用它，避免同一时间跑两遍。 */
let inFlight: Promise<AutoFetchSummary> | null = null

 interface AutoFetchSummary {
  at: string
  /** 参与本轮的项目数 */
  projects: number
  /** 其中真的 fetch 了且有结论的 */
  checked: number
  skipped: number
  failed: number
}

let lastRun: AutoFetchSummary | null = null

/** 上一轮的结果，给接口显示用。 */
export function lastAutoFetch(): AutoFetchSummary | null {
  return lastRun
}

/**
 * 跑一轮。
 *
 * **并发调用会共用同一轮**，不是各跑各的：定时器与「现在跑一轮」按钮很容易撞在
 * 一起（实测撞上过一次，2 个仓库跑出 4 条 fetch）。`Scheduler` 虽然保证了
 * 「同仓库不并发」，但两轮同时跑仍然会让每个仓库被 fetch 两次——纯粹浪费。
 */
export function runAutoFetch(db: DB): Promise<AutoFetchSummary> {
  if (inFlight) return inFlight
  inFlight = doAutoFetch(db).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function doAutoFetch(db: DB): Promise<AutoFetchSummary> {
  const { includeOwn } = readSettings(db)
  const rows = db
    .prepare(
      `SELECT id, name, path, is_own AS isOwn FROM projects
       WHERE remote_url IS NOT NULL AND remote_url <> ''
       ORDER BY id`,
    )
    .all() as { id: number; name: string; path: string; isOwn: number }[]

  const summary: AutoFetchSummary = {
    at: new Date().toISOString(),
    projects: 0,
    checked: 0,
    skipped: 0,
    failed: 0,
  }

  const targets = rows.filter((row) => {
    // 与批量检查同一条口径：personal 默认不联网。设置页可以打开。
    if (!includeOwn && row.isOwn) {
      summary.skipped += 1
      return false
    }
    summary.projects += 1
    return true
  })

  /*
    **并发交给 scheduler，不再一条一条 await**。
    原来是严格串行的 `for … await`：既让设置页的「并发上限」对这个后台轮次完全无效，
    又让 `POST /api/auto-fetch`（同步等整轮）在仓库多的时候挂上几分钟。
    `analyze` 内部自己按仓库排队并限流，所以这里直接 Promise.all 就是对的
    ——但**不能**再套一层 scheduler.map，那会对同一个 path 自锁（见 README 的坑）。
  */
  await Promise.all(
    targets.map(async (row) => {
      try {
        // 状态与流水都由 `syncRepo` 写（唯一入口）。label 进命令日志
        // ——用户要能看出这些进程是谁起的。
        const report = await syncRepo(db, row, { label: 'auto-fetch' })
        if (report.error) summary.failed += 1
        else summary.checked += 1
      } catch {
        // 单个仓库炸了不该中断整轮；错误本身已经记进日志与检查历史
        summary.failed += 1
      }
    }),
  )

  // 这一轮又给每个仓库写了一行；给表加个上限，别让它无限长
  pruneUpdateChecks(db)

  lastRun = summary
  return summary
}

/**
 * 离下一个整点 / 半点还有多久（毫秒）。
 *
 * 对齐的是**本地时间**的 :00 与 :30。实现是 `now % interval` 取补：地球上绝大多数
 * 时区偏移都是 15 分钟的整数倍，30 分钟一档因此正好落在 :00/:30 上（尼泊尔那种
 * +5:45 的会歪 15 分钟——那是个可以接受的小偏差，不值得为它引入时区库）。
 *
 * 纯函数，所以「对齐」这件事可以被逐条钉住（见 `test/auto-fetch.test.ts`）。
 * 恰好站在边界上时返回**整整一个间隔**：那一刻这一轮已经该跑了，下一轮在下一档。
 */
export function nextAlignedDelay(nowMs: number, intervalMs: number = INTERVAL_MS): number {
  return intervalMs - (nowMs % intervalMs)
}

/**
 * 启动定时同步。**重复调用只生效一次**（测试里会反复 bindSettings）。
 *
 * 节奏：启动 30 秒后跑一轮，之后每 :00 / :30 一轮。
 *
 * 三条与「用 setInterval 就行」不同的地方：
 *
 * 1. **首轮延迟 30 秒**：别和启动抢 I/O（建库、壳的 sidecar、首屏查询都在那一秒）。
 * 2. **递归 setTimeout 而不是 setInterval**：每轮都以「现在」重新算到下一档的距离，
 *    于是相位不会随着每轮耗时而漂。
 * 3. **合盖回来的补偿**：`setTimeout` 在休眠期间不走，醒来那一次会**晚到**——
 *    晚到也照样跑（这就是补跑），跑完再按当时的时间对齐。
 *    所以不需要另记「上次跑的时间」，比那套判断少一个可能出错的字段。
 */
export function startAutoFetch(db: DB): void {
  if (timer) return

  const tick = () => {
    // 不用在这里判「上一轮跑完没有」：`runAutoFetch` 自己会把并发调用合流
    void runAutoFetch(db).catch(() => {
      // doAutoFetch 内部已经逐个兜住了；这里只是不让定时器因为意外而中断
    })
  }

  const scheduleNext = () => {
    timer = setTimeout(() => {
      tick()
      scheduleNext()
    }, nextAlignedDelay(Date.now()))
    // 定时器不该拖住进程退出
    timer.unref?.()
  }

  // 首轮：启动 30 秒后
  timer = setTimeout(() => {
    tick()
    scheduleNext()
  }, FIRST_DELAY_MS)
  timer.unref?.()
}

export function stopAutoFetch(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
