import { probe, runGit, toGitError, type RunOptions } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import type { GitError, UpdateStatus } from './types.ts'

export type PullOutcome = 'updated' | 'already_up_to_date' | 'skipped' | 'failed'

export interface PullResult {
  outcome: PullOutcome
  /** 本次拉进来多少个提交 */
  newCommits: number
  status: UpdateStatus
  reason: string | null
  error: GitError | null
  /** pull 之后仓库的新状态描述（供结果表直接显示） */
  summary: string
}

export interface PullOptions extends Partial<RunOptions> {
  scheduler?: Scheduler
  /** 覆盖默认前置检查（测试用） */
  skipPreflight?: boolean
}

const SKIP = (reason: string, status: UpdateStatus): PullResult => ({
  outcome: 'skipped',
  newCommits: 0,
  status,
  reason,
  error: null,
  summary: `跳过：${reason}`,
})

/**
 * 唯一的更新入口，且只允许 fast-forward。
 *
 * 硬规则（照抄 github-kb）：
 * - 永远不用裸 `git pull`，脏工作区或已分叉的分支上它会产生 merge commit 或冲突
 * - 前置检查不过就跳过并说清原因，不硬来
 * - 不做 reset --hard / clean / push / 任何历史重写
 */
export async function pullRepo(path: string, options: PullOptions = {}): Promise<PullResult> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.schedule(path, async () => {
    const cwd: RunOptions = { cwd: path, timeoutMs: options.timeoutMs }

    if (!options.skipPreflight) {
      const pre = await preflight(cwd)
      if (pre) return pre
    }

    const before = await countCommits(cwd, 'HEAD')
    const result = await runGit(['pull', '--ff-only'], { ...cwd, env: { GIT_PROGRESS: '0' } })

    if (result.code !== 0) {
      const error = toGitError(result, 'pull 失败')
      return {
        outcome: 'failed',
        newCommits: 0,
        status: 'error',
        reason: null,
        error,
        summary: `失败：${error.message}`,
      }
    }

    const after = await countCommits(cwd, 'HEAD')
    const newCommits = before !== null && after !== null ? Math.max(0, after - before) : 0
    const upToDate = /already up to date/i.test(result.stdout)

    return {
      outcome: upToDate || newCommits === 0 ? 'already_up_to_date' : 'updated',
      newCommits,
      status: 'up_to_date',
      reason: null,
      error: null,
      summary: upToDate || newCommits === 0 ? '已是最新' : `已更新 ${newCommits} 个提交`,
    }
  })
}

/** 返回非 null 表示该跳过。 */
async function preflight(cwd: RunOptions): Promise<PullResult | null> {
  const inside = await probe(['rev-parse', '--is-inside-work-tree'], cwd)
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return SKIP('不是 git 仓库', 'not_a_repo')
  }

  const hasCommits = (await probe(['rev-parse', '--verify', '-q', 'HEAD'], cwd)).ok
  if (!hasCommits) return SKIP('仓库还没有提交', 'no_commits')

  const porcelain = await probe(['status', '--porcelain'], cwd)
  if (porcelain.ok && porcelain.stdout.trim()) {
    const count = porcelain.stdout.split('\n').filter((l) => l.trim()).length
    return SKIP(`工作区有 ${count} 处未提交改动`, 'dirty')
  }

  const head = await probe(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
  if (!head.ok) return SKIP('HEAD 处于游离状态', 'detached')

  const upstream = await probe(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
  if (!upstream.ok) return SKIP('当前分支没有上游', 'no_upstream')

  const counts = await probe(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd)
  if (counts.ok) {
    const [ahead = 0, behind = 0] = counts.stdout.trim().split(/\s+/).map((n) => Number(n))
    if (ahead > 0 && behind > 0) {
      return SKIP(`分支已分叉（领先 ${ahead}、落后 ${behind}），需要手动处理`, 'diverged')
    }
    if (behind === 0) {
      return {
        ...SKIP('没有需要拉取的提交', 'up_to_date'),
        outcome: 'already_up_to_date',
        summary: '已是最新',
      }
    }
  }

  return null
}

async function countCommits(cwd: RunOptions, rev: string): Promise<number | null> {
  const result = await probe(['rev-list', '--count', rev], cwd)
  if (!result.ok) return null
  return Number(result.stdout.trim())
}
