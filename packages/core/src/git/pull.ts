import { probe, runGit, toGitError, type RunOptions } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import { readWorktree } from './inspect/via-cli.ts'
import { VERDICT_REASON } from '../types.ts'
import type { PullOutcome, PullResult, UpdateStatus } from './types.ts'

export type { PullOutcome, PullResult }

export interface PullOptions extends Partial<RunOptions> {
  scheduler?: Scheduler
  /** 覆盖默认前置检查（测试用） */
  skipPreflight?: boolean
  /**
   * 上次见到的上游 SHA（来自 `update_checks`，由 server 侧传进来——core 不认识数据库）。
   *
   * 给了它，`pullRepo` 就会在动手之前**先 fetch 一次、再拿基线和新的上游比**：
   * 那个提交不再在新上游历史里 ⇒ 作者改写过历史（force push / 回退 / 换仓库），
   * 直接拒绝，连 `--ff-only` 都不发。
   *
   * 为什么必须在这里做，而不是只在调用方做：调用方那道闸读的是**上次检查的结论**，
   * 而「上次检查」到「这次点更新」之间，作者完全可能刚好 force push。
   * 那种情况本地 HEAD 仍是新历史的祖先（`recommend.ts` 文件头点名的限制），
   * `pull --ff-only` 会毫无怨言地快进——静默更新到一个被改写的仓库。
   *
   * **这一条只是兜底**：基线优先取「本机现在指着的上游 ref」（fetch 之前读），
   * 只有它读不出来时才用这里传进来的值。理由是 SHA 属于**某一条**
   * 上游 ref，而 `update_checks` 里不记那是哪一条——在 A 分支上记录的值拿去问
   * B 分支，答案必然是「不是祖先」，就成了假警报（详见 `detectRewrittenHistory`）。
   */
  lastUpstreamSha?: string | null
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

    // 「作者改写过历史」这道闸：fetch 之前先记下本机的上游，fetch 之后拿它比。
    // 顺序不能反——pull 内部的 fetch 会把 @{u} 就地更新成新历史，那时再比就永远「还在」了
    //（读基线必须在 fetch 之前）。
    const rewritten = await detectRewrittenHistory(cwd, options.lastUpstreamSha ?? null)
    if (rewritten) return SKIP(rewritten, 'diverged')

    // 不在这里用 ahead/behind 提前判「没东西可拉」：那个数字来自上次 fetch，是旧的。
    // 直接让 `pull --ff-only` 去 fetch + 快进，它才是权威。
    //
    // 注意这里**没有** `GIT_PROGRESS`：git 没有这个环境变量（它只认
    // GIT_PROGRESS_DELAY / `--progress`），写了也是死配置。进度条本来就不会出现
    // ——stdout 是管道，不是 tty，git 自己会闭嘴。
    const result = await runGit(['pull', '--ff-only'], cwd)

    if (result.code !== 0) {
      // pull 失败时它已经 fetch 过了，refs 是新的——这时候再判分叉才准
      const blocked = await explainBlocked(cwd)
      if (blocked) return blocked

      const combined = `${result.stderr}\n${result.stdout}`
      if (/no upstream|no tracking information|does not have a branch/i.test(combined)) {
        return SKIP('当前分支没有上游', 'no_upstream')
      }

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

    // pull 前后的 HEAD 差值：reflog 里 HEAD@{1} 就是拉之前的那个 commit
    const newCommits = await countPulled(cwd)
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

/** 快进了几个提交：拉之前的 HEAD 留在 reflog 里，差值就是答案。 */
async function countPulled(cwd: RunOptions): Promise<number> {
  const result = await probe(['rev-list', '--count', 'HEAD@{1}..HEAD'], cwd)
  if (!result.ok) return 0
  const n = Number(result.stdout.trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * 基线还在不在新上游里？返回非 null = **别拉**（附理由）。
 *
 * 基线优先取**本机现在指着的上游 ref**（fetch 之前读）：它是同一条 ref 的上一个值，
 * 天然不会串到别的分支上。传进来的 `explicitBaseline`（数据库里记的那个 SHA）
 * 只在本地读不出来时兜底——SHA 本身不带「属于哪条 ref」的信息，拿 A 分支的值去问
 * B 分支，答案必然是「不是祖先」，那就是假警报，而假警报比「判不出来」坏得多。
 *
 * 三步，每一步失败都退回「不下结论」（返回 null，让 pull 照常去跑并报真实原因）：
 * 1. `fetch --prune origin` —— 只更新 `refs/remotes/*`，不碰工作区。
 *    失败（断网 / 认证 / 没有 origin）时不拦：那不是「作者改写了历史」，
 *    真正的失败原因交给 pull 自己报更准。
 * 2. `merge-base --is-ancestor <基线> @{u}` —— 退出码 0 = 还在（正常快进），
 *    1 = **确定不在了**（改写过），其它 = 出错，不敢下结论。
 * 3. 没有上游（`@{u}` 解析不出来）时也没有可比的对象，直接放行。
 */
async function detectRewrittenHistory(
  cwd: RunOptions,
  explicitBaseline: string | null,
): Promise<string | null> {
  const upstream = await probe(['rev-parse', '--verify', '-q', '@{u}'], cwd)
  const local = upstream.ok ? upstream.stdout.trim() : ''
  const baseline = local.length > 0 ? local : explicitBaseline
  if (!baseline) return null

  const fetch = await probe(['fetch', '--prune', 'origin'], cwd)
  if (!fetch.ok) return null

  const ancestor = await probe(['merge-base', '--is-ancestor', baseline, '@{u}'], cwd)
  if (ancestor.ok) return null
  if (ancestor.result.code !== 1) return null

  return `上次见到的上游提交 ${baseline.slice(0, 7)} 已经不在远程分支的历史里了——${VERDICT_REASON.rewritten}`
}

/**
 * 脏工作区的说明。**分开说「你改过的文件」与「未跟踪的新文件」**——
 * 这两种对「能不能拉」的含义完全不同：
 * - 已跟踪被改：更新可能覆盖它们，要用户自己决定
 * - 未跟踪新文件：多半是构建产物、`.venv`、下载的数据，更新通常踩不到
 *
 * 以前一律说「工作区有 N 处未提交改动」。用户看到一堆跟他无关的构建产物
 * 被当成拦路的理由，只会觉得这工具在碍事。
 * **判据没变（照样跳过），变的是把「是什么」说清楚。**
 */
export function describeWorktree(input: { trackedChanges: number; untrackedFiles: number }): string {
  const { trackedChanges, untrackedFiles } = input
  if (trackedChanges > 0 && untrackedFiles > 0) {
    return `工作区有改动：${trackedChanges} 个已跟踪文件被改过（更新可能覆盖它们），另有 ${untrackedFiles} 个未跟踪文件（多半是构建产物、依赖目录这类）`
  }
  if (trackedChanges > 0) {
    return `有 ${trackedChanges} 个已跟踪文件被改过，更新可能覆盖它们`
  }
  return `只有 ${untrackedFiles} 个未跟踪文件（多半是构建产物、依赖目录这类），但为稳妥起见没有自动更新`
}

/** 返回非 null 表示该跳过。全部是本地事实，不依赖 fetch。 */
async function preflight(cwd: RunOptions): Promise<PullResult | null> {
  const inside = await probe(['rev-parse', '--is-inside-work-tree'], cwd)
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return SKIP('不是 git 仓库', 'not_a_repo')
  }

  const hasCommits = (await probe(['rev-parse', '--verify', '-q', 'HEAD'], cwd)).ok
  if (!hasCommits) return SKIP('仓库还没有提交', 'no_commits')

  // 工作区判定与读状态共用同一份实现（`readWorktree`），不在这里另写一遍 porcelain 解析
  const facts = await readWorktree(cwd.cwd, { timeoutMs: cwd.timeoutMs, label: 'pull' })
  // 读不出来时**不往下走**：这时「脏不脏」是未知的，而未知不等于干净
  if (facts === null) return SKIP('读不出工作区状态，不敢动它', 'error')
  if (facts.dirty) return SKIP(describeWorktree(facts), 'dirty')

  const head = await probe(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
  if (!head.ok) return SKIP('HEAD 处于游离状态', 'detached')

  // 这里不查上游：远程跟踪引用可能只是还没 fetch 出来，
  // 那种情况真正的失败原因在远程（网络/认证），让 pull 去报更准
  return null
}

/**
 * pull 失败后判断「是不是本来就不该硬来」。
 * 此刻 refs 已被 pull 刷新过，所以 ahead/behind 是准的。
 */
async function explainBlocked(cwd: RunOptions): Promise<PullResult | null> {
  const counts = await probe(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd)
  if (!counts.ok) return null
  const [ahead = 0, behind = 0] = counts.stdout.trim().split(/\s+/).map((n) => Number(n))

  if (ahead > 0 && behind > 0) {
    return SKIP(
      `分支已分叉（领先 ${ahead}、落后 ${behind}），需要你自己决定怎么合`,
      'diverged',
    )
  }
  if (ahead > 0) {
    return SKIP(`本地有 ${ahead} 个提交没推，远程没有新东西可拉`, 'ahead')
  }
  if (behind > 0) {
    return SKIP(`本地有提交会挡路，无法快进到远程的 ${behind} 个提交`, 'diverged')
  }
  return null
}
