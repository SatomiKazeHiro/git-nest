/**
 * 跨仓库并发闸门 + 同仓库串行队列。
 *
 * 为什么要两把锁：
 * - 同一仓库的 git 命令串行：并发跑同一个仓库会撞 index.lock / refs 竞争
 * - 跨仓库并发上限 4：防本机 IO 打满，也防远程 host 限流
 */
export interface SchedulerOptions {
  /** 跨仓库并发上限 */
  concurrency?: number
}

export class Scheduler {
  private limit: number
  private active = 0
  private readonly queue: (() => void)[] = []
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(options: SchedulerOptions = {}) {
    this.limit = Math.max(1, options.concurrency ?? 4)
  }

  /** 运行中改并发上限（设置页可调）。已经在跑的不打断，只影响排队中的。 */
  setLimit(limit: number): void {
    this.limit = Math.max(1, limit)
    // 放低了就把队列里的放出去几个
    while (this.active < this.limit) {
      const next = this.queue.shift()
      if (!next) break
      next()
    }
  }

  /** 拿不到许可就排队；任务结束（无论成败）都会释放。 */
  private limited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1
        task().then(resolve, reject).finally(() => {
          this.active -= 1
          this.queue.shift()?.()
        })
      }
      if (this.active < this.limit) start()
      else this.queue.push(start)
    })
  }

  /**
   * 同一个 key（一般是仓库路径）的任务严格排队执行。
   *
   * 注意：**不要在已排队的任务里再对同一个 key 调 schedule**——那会等自己完成，死锁。
   * core 里 getRepoStatus / analyzeUpdates / pullRepo 内部都自己排队了，
   * 所以调用方直接 Promise.all 就行，限流交给它们。
   */
  schedule<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    const run = previous.then(
      () => this.limited(task),
      () => this.limited(task),
    )
    const settled: Promise<unknown> = run.catch(() => undefined)
    this.chains.set(key, settled)
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key)
    })
    return run
  }

  /** 批量执行，key 为仓库路径；跨仓库并发受 limit 限制。 */
  map<T, R>(items: T[], keyOf: (item: T) => string, run: (item: T) => Promise<R>): Promise<R[]> {
    return Promise.all(items.map((item) => this.schedule(keyOf(item), () => run(item))))
  }
}

export const defaultScheduler = new Scheduler()
