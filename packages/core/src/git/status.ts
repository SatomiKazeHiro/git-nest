import { probe, toGitError, runGit, type RunOptions } from './runner.ts'
import type { Scheduler } from './scheduler.ts'
import { readRepoStatus, readRepoStatuses, type ReadStatusOptions, type StatusProfile } from './inspect/index.ts'
import type { RepoStatus } from './types.ts'

export type { StatusProfile }

export interface StatusOptions {
  timeoutMs?: number
  scheduler?: Scheduler
  /** 读多少，见 `inspect/index.ts`。缺省 `full`（行为同改造前）。 */
  profile?: StatusProfile
  /**
   * 上次检查时上游指向的 SHA（来自 `update_checks`）。
   * full 档靠它判「作者 force push 改写了历史」——core 不认识数据库，
   * 这个事实只能由调用方提供。见 `inspect/recommend.ts` 文件头的限制说明。
   */
  lastUpstreamSha?: string | null
  /** 谁发起的这次读取（进命令日志，不影响行为）。 */
  label?: string
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
 * 读 origin 地址。**纯实现，自己不排队。**
 *
 * 走 `git remote get-url origin`，而不是读 `.git/config` 里的 `remote.origin.url`。
 * 两者在配了 `url.<base>.insteadOf` 的机器上**不一样**：前者会套用重写规则。
 * 这个值要落库、还要在详情页变成一个可点的链接，所以取「git 真正会用的那个地址」
 * ——insteadOf 恰恰是 SSH 仓库换成 HTTPS 的常见做法（`gh` / 镜像都这么干），
 * 拿配置里的原文反而给不出链接。它也和用户 `git remote -v` 看到的一致，好对账。
 *
 * 需要「是不是仓库」那一类事实时别用它：那是 `readRepoFacts` 的事（读 config，
 * 0 进程，只用来判有没有 remote）。
 *
 * **自己排队**这件事和这个函数无关：要限流就用 `getRemoteUrl`（外壳），
 * 或者由调用方自己 `scheduler.schedule(path, () => readRemoteUrl(path))`。
 * 拆成两个函数就是为了让「谁排队」这件事只有一个答案——原来只有一个函数，
 * 它既排队又能被调用方再包一层排队，于是 server 侧只能靠**故意不传 scheduler**
 * 来避免同 key 自锁；谁顺手补上那个参数就是死锁（见 `scheduler.ts` 文件头）。
 */
export async function readRemoteUrl(
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const result = await probe(['remote', 'get-url', 'origin'], {
    cwd: path,
    timeoutMs: options.timeoutMs,
  })
  if (!result.ok) return null
  const url = result.stdout.trim()
  return url.length > 0 ? url : null
}

/**
 * `readRemoteUrl` + 同仓库串行。调用方**要么**用它（scheduler 由这里管），
 * **要么**自己用 `scheduler.schedule(path, () => readRemoteUrl(path))`，
 * 不要两者都做（那就是同一个 key 的 schedule 里再 schedule，直接自锁）。
 */
export function getRemoteUrl(
  path: string,
  options: { timeoutMs?: number; scheduler?: Scheduler } = {},
): Promise<string | null> {
  const read = () => readRemoteUrl(path, { timeoutMs: options.timeoutMs })
  const scheduler = options.scheduler
  return scheduler ? scheduler.schedule(path, read) : read()
}

/** 读工作区改动行数。pull 的前置检查用它——那是安全闸，必须与 git 逐字节一致。 */
export { parseDirtyCount } from './inspect/via-cli.ts'

export { toGitError, runGit }
export type { RunOptions }
