import {
  Scheduler,
  analyzeUpdates,
  getLog,
  getRemoteUrl,
  getRepoStatus,
  getRepoStatuses,
  pullRepo,
  type RepoStatus,
} from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import { readSettings } from './settings.ts'

export { analyzeUpdates, getLog, getRemoteUrl, getRepoStatus, getRepoStatuses, pullRepo }
export type { UpdateReport } from '@git-nest/core/git'

/**
 * git 层在 server 侧的统一入口。
 *
 * 超时与并发上限来自设置表（可在设置页改），所以每次调用现读一次——
 * 本地工具，没有值得缓存的东西。
 */

/** 同仓库串行、跨仓库并发上限可动态调整 */
export const scheduler = new Scheduler({ concurrency: 4 })

/** 状态短缓存：列表页一次要问十几个仓库，同一次渲染不该重复跑 git */
const STATUS_TTL_MS = 3_000
const statusCache = new Map<string, { at: number; value: RepoStatus }>()

let db: DB | null = null

export function bindSettings(database: DB): void {
  db = database
  scheduler.setLimit(readSettings(database).concurrency)
}

function current() {
  if (!db) return { gitTimeoutMs: 120_000, concurrency: 4 }
  return readSettings(db)
}

export async function repoStatus(
  path: string,
  options: { fresh?: boolean } = {},
): Promise<RepoStatus> {
  const { gitTimeoutMs } = current()
  scheduler.setLimit(current().concurrency)

  if (options.fresh) {
    statusCache.delete(path)
    return getRepoStatus(path, { timeoutMs: gitTimeoutMs, scheduler })
  }
  const hit = statusCache.get(path)
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value

  const value = await getRepoStatus(path, { timeoutMs: gitTimeoutMs, scheduler })
  statusCache.set(path, { at: Date.now(), value })
  return value
}

export async function repoStatuses(paths: string[]): Promise<RepoStatus[]> {
  const { gitTimeoutMs, concurrency } = current()
  scheduler.setLimit(concurrency)

  const now = Date.now()
  const fresh = paths.filter((p) => {
    const hit = statusCache.get(p)
    return !(hit && now - hit.at < STATUS_TTL_MS)
  })
  if (fresh.length > 0) {
    const results = await getRepoStatuses(fresh, { timeoutMs: gitTimeoutMs, scheduler })
    for (const status of results) statusCache.set(status.path, { at: Date.now(), value: status })
  }
  return paths.map((p) => statusCache.get(p)!.value)
}

/** 读完状态想知道「刚才那条路要拉什么」时用这个 */
export function analyze(path: string) {
  const { gitTimeoutMs } = current()
  return analyzeUpdates(path, { timeoutMs: gitTimeoutMs, scheduler })
}

export function pull(path: string) {
  const { gitTimeoutMs } = current()
  return pullRepo(path, { timeoutMs: gitTimeoutMs, scheduler })
}

export function repoLog(path: string, max: number) {
  const { gitTimeoutMs } = current()
  return getLog(path, { maxCount: max, timeoutMs: gitTimeoutMs, scheduler })
}

export function clearStatusCache(): void {
  statusCache.clear()
}
