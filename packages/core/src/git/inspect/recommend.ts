/**
 * 「推不推荐更新」——**这是这个软件一阶段最要紧的一件事**。
 *
 * 用户的原话：要「推不推荐更新（尤其避免更新到作者删库或者重置仓库
 * （如侵权、闭源等等）的情况）」。
 *
 * 所以这里不只是算「落后几个提交」，而是回答**拉了会不会出事**。
 *
 * 分两层，因为这两件事的成本差很远：
 *
 * 1. **读事实**（`readRecommendationFacts`）：跑 git 命令。
 * 2. **下判决**（`applyVerdict`）：**纯函数，零进程**。
 *
 * 分开是为了让调用方复用已有的事实。`analyzeUpdates` 本来就读了 ahead/behind
 * 和上游，`inspect` 也一样——如果判决自己去重跑一遍，每个仓库要多花 4 次进程。
 * （这不是假想：第一版就是这么写的，`status-spawns.test.ts` 立刻从 3 涨到 7。）
 *
 * 判据全部落在三个问题上：
 *
 *   Q1. 两者还有共同祖先吗？        没有 ⇒ 换了一个仓库（unrelated）
 *   Q2. 本地 HEAD 是上游的祖先吗？   是   ⇒ 能快进（safe）
 *   Q3. 上游是本地 HEAD 的祖先吗？   是   ⇒ 本地领先，没有新东西可拉
 *   都不是                            ⇒ 分叉
 *
 * 用的是 `git merge-base --is-ancestor`，退出码语义实测确认：
 * 0 = 是祖先，1 = 不是，其它 = 出错。不解析文本。
 *
 * ⚠️ 一个必须说清的限制（探针实测，见 `test/git/recommend.test.ts`）：
 *
 *   **「作者 force push 掉了本地从没读过的提交」是看不出来的。**
 *
 * 那种情况下本地 HEAD 仍然是新历史的祖先，git 自己也会毫无怨言地快进——
 * 因为从本地的视角看，世界只是往前走了一步。要抓住它，只能拿**上次见到的
 * 上游 SHA** 来比（`baselineSha`）。没有那个值时，只能靠 `unrelated` 兜住
 * 最严重的一类（作者把历史整个换掉）。
 */

import { probe, type RunOptions } from '../runner.ts'
import { VERDICT_REASON } from '../../types.ts'
import type { InspectOptions, UpdateRecommendation } from './types.ts'

/** 判决需要的全部事实。都可以由调用方复用自己已经读到的结果。 */
export interface RecommendationFacts {
  /** `merge-base HEAD @{u}` 有没有输出。null = 读不出来（不敢下结论） */
  hasCommonAncestor: boolean | null
  /** 本地 HEAD 是不是上游的祖先。null = 读不出来 */
  headIsAncestor: boolean | null
  /** 上游是不是本地 HEAD 的祖先。null = 读不出来 */
  upstreamIsAncestor: boolean | null
  ahead: number
  behind: number
  /** 上次见到的上游 SHA 还在不在新历史里。false ⇒ 作者改写了历史 */
  baselineStillPresent: boolean | null
}

/** 决定判决的三个 git 查询（外加一次 baseline 存在性检查）。 */
export async function readRecommendationFacts(
  path: string,
  options: InspectOptions = {},
): Promise<RecommendationFacts | null> {
  const cwd: RunOptions = { cwd: path, timeoutMs: options.timeoutMs }

  const hasUpstream = await probe(['rev-parse', '--verify', '-q', '@{u}'], cwd)
  if (!hasUpstream.ok) return null

  const counts = await probe(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd)
  if (!counts.ok) return null
  const [aheadRaw, behindRaw] = counts.stdout.trim().split(/\s+/)
  const ahead = Number(aheadRaw)
  const behind = Number(behindRaw)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null

  return {
    hasCommonAncestor: await hasCommonAncestor(cwd),
    headIsAncestor: await isAncestor(cwd, 'HEAD', '@{u}'),
    upstreamIsAncestor: await isAncestor(cwd, '@{u}', 'HEAD'),
    ahead,
    behind,
    baselineStillPresent: null,
  }
}

/** 把「上次见到的上游 SHA」这个事实补进 facts（单独一次 git 调用）。 */
export async function readBaselinePresence(
  path: string,
  baselineSha: string,
  options: InspectOptions = {},
): Promise<boolean | null> {
  return isAncestor(
    { cwd: path, timeoutMs: options.timeoutMs },
    baselineSha,
    '@{u}',
  )
}

/**
 * 下判决。**纯函数，零进程**——所有事实都由调用方提供。
 *
 * `null` 只出现在「连 ahead/behind 都没有」这种情况（调用方该报 error）。
 * 只要 facts 有值，就一定给出一个判决，不会含糊。
 */
export function applyVerdict(facts: RecommendationFacts): UpdateRecommendation {
  // ① 作者改写上游了吗？这一条要最先判：它的后果最严重，
  //    而且会被后面的判据掩盖（force push 之后往往同时表现为「分叉」）。
  if (facts.baselineStillPresent === false) return only('rewritten')

  // ② 还是同一个仓库吗？
  if (facts.hasCommonAncestor === false) return only('unrelated')

  const { ahead, behind } = facts

  // ③ Q2：本地是上游的祖先 ⇒ 能快进
  if (facts.headIsAncestor === true) {
    if (behind === 0) {
      return { verdict: 'safe', ahead, behind, canPull: false, reason: '已是最新，没有要拉的。' }
    }
    return {
      verdict: 'safe',
      ahead,
      behind,
      canPull: true,
      reason: `可以直接快进到远程的 ${behind} 个提交。`,
    }
  }

  // ④ Q3：上游是本地的祖先 ⇒ 本地领先
  if (facts.upstreamIsAncestor === true) {
    return {
      verdict: 'safe',
      ahead,
      behind,
      canPull: false,
      reason: `本地有 ${ahead} 个提交还没推，远程没有新东西可拉。`,
    }
  }

  // ⑤ 都有共同祖先、互相又不是祖先 ⇒ 真分叉
  return { verdict: 'diverged', ahead, behind, canPull: false, reason: VERDICT_REASON.diverged }
}

/** 单独读一次并下判决（给不需要复用事实的调用方用）。 */
export async function readRecommendation(
  path: string,
  options: InspectOptions & { baselineSha?: string | null } = {},
): Promise<UpdateRecommendation | null> {
  const facts = await readRecommendationFacts(path, options)
  if (!facts) return null
  if (options.baselineSha) {
    facts.baselineStillPresent = await readBaselinePresence(path, options.baselineSha, options)
  }
  return applyVerdict(facts)
}

/** 明确不能拉的判决：不给 ahead/behind（那数字在「不能拉」的语境里只会误导）。 */
function only(verdict: 'rewritten' | 'unrelated'): UpdateRecommendation {
  return { verdict, ahead: null, behind: null, canPull: false, reason: VERDICT_REASON[verdict] }
}

/**
 * `--is-ancestor` 的退出码：0 = 是祖先，1 = 不是，其它 = 真出错（仓库坏了之类）。
 * 只有 1 才是「确定不是」，其它失败返回 null——**不敢下结论时不下结论**。
 */
async function isAncestor(
  cwd: RunOptions,
  ancestor: string,
  descendant: string,
): Promise<boolean | null> {
  const result = await probe(['merge-base', '--is-ancestor', ancestor, descendant], cwd)
  if (result.ok) return true
  return result.result.code === 1 ? false : null
}

/**
 * 两个历史还有没有共同祖先？`merge-base` 输出为空 = 没有。
 *
 * 这是「作者重置/重建了仓库」的判据：本地那棵树和上游那棵树**一点关系都没有**，
 * 拉进来等于换一个仓库，本地的东西全成孤儿。
 */
async function hasCommonAncestor(cwd: RunOptions): Promise<boolean | null> {
  const result = await probe(['merge-base', 'HEAD', '@{u}'], cwd)
  if (result.ok) return result.stdout.trim().length > 0
  // exit 1 是 git 表达「没有共同祖先」的方式，不是错误
  return result.result.code === 1 ? false : null
}
