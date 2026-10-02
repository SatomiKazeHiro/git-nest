import { toGitError, runGit, type RunOptions } from './runner.ts'
import type { Scheduler } from './scheduler.ts'
import { readRepoFacts } from './inspect/via-lib.ts'
import { readRepoStatus, readRepoStatuses, type ReadStatusOptions, type StatusProfile } from './inspect/index.ts'
import type { RepoStatus } from './types.ts'

export type { StatusProfile }

export interface StatusOptions {
  timeoutMs?: number
  scheduler?: Scheduler
  /** 读多少，见 `inspect/index.ts`。缺省 `full`（行为同改造前）。 */
  profile?: StatusProfile
}

type ReadOptions = ReadStatusOptions

/**
 * 仓库实时状态：分支、脏标记、ahead/behind、最后提交时间。
 *
 * 注意 ahead/behind 只反映「上一次 fetch 之后」的事实——它不会自己去联网。
 * 想要最新的数字必须先 fetch，那是 analyzeUpdates（M3）的事。
 *
 * 真正的读取在 `inspect/`：那里按「要读什么」分了两条路，且每条事实只有一个提供方。
 * 这里只是对外的那层壳。
 */
export async function getRepoStatus(path: string, options: StatusOptions = {}): Promise<RepoStatus> {
  return readRepoStatus(path, options as ReadOptions)
}

/** 批量查状态：跨仓库并发受 scheduler 限制，同仓库自动串行。 */
export async function getRepoStatuses(
  paths: string[],
  options: StatusOptions = {},
): Promise<RepoStatus[]> {
  return readRepoStatuses(paths, options as ReadOptions)
}

/**
 * 状态机本身搬到了 `types.ts`（浏览器安全的 barrel）：详情页摘要要用**同一份**
 * 优先级重算结论（让「跟远程差多少」当主角、脏标记降级），两处各写一份必然飘开。
 * 这里原样再导出，保持 `@git-nest/core/git` 的对外形状不变。
 */
export { deriveStatus, type DeriveInput } from '../types.ts'

/**
 * 只读 origin 地址。清单里的 remote_url 在添加项目时用它自动填。
 *
 * 走库读 `.git/config`（这一条只需要一个文件，不必为此起一次 git.exe）。
 * 接受 `timeoutMs` / `scheduler`：调用方（server）要让它受设置里的超时约束，
 * 并且和同一个仓库的其它操作共用一把锁。
 */
export async function getRemoteUrl(
  path: string,
  options: { timeoutMs?: number; scheduler?: Scheduler } = {},
): Promise<string | null> {
  const task = async () => {
    const facts = await readRepoFacts(path, { timeoutMs: options.timeoutMs })
    return facts.error ? null : facts.remoteUrl
  }
  const scheduler = options.scheduler
  return scheduler ? scheduler.schedule(path, task) : task()
}

/** 读工作区改动行数。pull 的前置检查用它——那是安全闸，必须与 git 逐字节一致。 */
export { parseDirtyCount } from './inspect/via-cli.ts'

export { toGitError, runGit }
export type { RunOptions }
