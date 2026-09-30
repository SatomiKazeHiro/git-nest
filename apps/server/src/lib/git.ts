// git 层只能从 '@git-nest/core/git' 引入：它依赖 node:child_process，
// 浏览器端从 '@git-nest/core' 拿不到它。
import {
  getLog,
  getRemoteUrl,
  getRepoStatus,
  getRepoStatuses,
  type RepoStatus,
} from '@git-nest/core/git'

/** 单条 git 命令的硬超时，可通过环境变量调小（本地大仓库用）。 */
export const gitTimeoutMs = Number(process.env['GIT_NEST_GIT_TIMEOUT'] ?? 120_000)

export { getLog, getRepoStatus, getRepoStatuses, getRemoteUrl }

/** 提交图数据，带默认条数上限。 */
export async function getRepoLog(path: string, max = 200) {
  return getLog(path, { maxCount: max, timeoutMs: gitTimeoutMs })
}

/**
 * 状态短缓存：列表页一次要问十几个仓库，同一次渲染里不该重复跑 git。
 * 只缓存几秒——状态本来就该是现查的，缓存久了反而会骗人。
 */
const TTL_MS = Number(process.env['GIT_NEST_STATUS_TTL'] ?? 3_000)
const cache = new Map<string, { at: number; value: RepoStatus }>()

export async function repoStatus(path: string, options: { fresh?: boolean } = {}) {
  if (options.fresh) {
    cache.delete(path)
    return getRepoStatus(path, { timeoutMs: gitTimeoutMs })
  }
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const value = await getRepoStatus(path, { timeoutMs: gitTimeoutMs })
  cache.set(path, { at: Date.now(), value })
  return value
}

export async function repoStatuses(paths: string[]) {
  const now = Date.now()
  const fresh = paths.filter((p) => {
    const hit = cache.get(p)
    return !(hit && now - hit.at < TTL_MS)
  })
  if (fresh.length > 0) {
    const results = await getRepoStatuses(fresh, { timeoutMs: gitTimeoutMs })
    for (const status of results) cache.set(status.path, { at: Date.now(), value: status })
  }
  return paths.map((p) => cache.get(p)!.value)
}

export function clearStatusCache(): void {
  cache.clear()
}
