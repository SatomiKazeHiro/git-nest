/**
 * 「工作区 / ahead-behind / 最后提交」的实现：**真 git**。
 *
 * 为什么这三条不走库：
 *
 * - **脏标记**是 `pull --ff-only` 的安全闸（`pull.ts` 的不变量：工作区脏就绝不自动更新），
 *   而且它的完整语义（重命名、未跟踪、忽略规则、子模块、CRLF）就是 git 自己那一套。
 *   库的 `statusMatrix` 要遍历工作区，实测大仓库 1.6–3s，比 spawn git 还慢十几倍。
 * - **ahead/behind** 要走提交图。库没有现成实现（`_log` 的 `ahead`/`behind` 参数是
 *   被静默忽略的），手写可达性遍历实测约 200ms/仓库，比 `rev-list` 一次调用还慢。
 * - **最后提交**要读对象，那是 pack index 解析（见 `via-lib.ts` 的注释）。
 *
 * 这里的三条命令都是**只读**的。写操作（fetch / pull）在各自的模块里，不走这一层。
 */

import { probe, type RunOptions } from '../runner.ts'
import type {
  CommitFacts,
  CommitInspector,
  DivergenceFacts,
  DivergenceInput,
  DivergenceInspector,
  InspectOptions,
  WorktreeFacts,
  WorktreeInspector,
} from './types.ts'

/** 字段分隔符，跟 `log.ts` 用同一个约定，避免 message 里的字符串行。 */
const FIELD = '\x1f'

/** 工作区改动：一行一个文件（含未跟踪）。空输出 = 干净。 */
export function parseDirtyCount(raw: string): number {
  return raw.split('\n').filter((l) => l.trim().length > 0).length
}

/**
 * 统计改动里「已跟踪被改」与「未跟踪新文件」各有多少。
 *
 * porcelain 的格式是 `XY <path>`：未跟踪是 `??`。其余（` M`、`M `、`A `、`D `、
 * `R `…）都算已跟踪的改动。**不需要解析路径**（路径可能带引号、可能含空格），
 * 只看前两个字符就够。
 */
export function countByKind(raw: string): { trackedChanges: number; untrackedFiles: number } {
  let trackedChanges = 0
  let untrackedFiles = 0
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    if (line.startsWith('??')) untrackedFiles += 1
    else trackedChanges += 1
  }
  return { trackedChanges, untrackedFiles }
}

/** 脏标记：`git status --porcelain` 一行一个改动文件。 */
export const readWorktree: WorktreeInspector = async (
  path: string,
  options: InspectOptions,
): Promise<WorktreeFacts | null> => {
  const result = await probe(['status', '--porcelain'], cwd(path, options))
  // 读不出来时返回 null，**不能**返回「干净」——那正好是最危险的默认值
  if (!result.ok) return null
  const { trackedChanges, untrackedFiles } = countByKind(result.stdout)
  const changeCount = trackedChanges + untrackedFiles
  return { dirty: changeCount > 0, changeCount, trackedChanges, untrackedFiles }
}

/**
 * 领先/落后，以及「上游是不是真的没了」。
 *
 * `rev-list HEAD...@{u}` 失败时要分清两种：
 * - **压根没配上游**（常态）：报错是 `unknown revision or path not in the working tree`，
 *   跟「配了但引用不在」一模一样。这种必须靠 `input.upstream` 否掉——
 *   git 自己分不出来，不能瞎猜成 gone。
 * - **配了上游但解析不出来**：上游被远程删了。判据比库的 ref 探测更硬：
 *   引用在、对象从没 fetch 过（浅克隆）也落在这一类里。
 *
 * 调用方拿到 null 就保持 ahead/behind 为 null，不要瞎猜成 0。
 */
export const readDivergence: DivergenceInspector = async (
  path: string,
  options: InspectOptions,
  input: DivergenceInput,
): Promise<DivergenceFacts | null> => {
  // 没配上游就不必起进程：git 只会回一句分不出所以然的错
  if (input.upstream === null) return null

  const result = await probe(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd(path, options))
  if (!result.ok) {
    const combined = `${result.result.stderr}\n${result.result.stdout}`
    if (/unknown revision|no such|does not have a branch|no upstream|ambiguous argument/i.test(combined)) {
      return { ahead: null, behind: null, upstreamGone: true }
    }
    return null
  }
  const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/)
  const ahead = Number(aheadRaw)
  const behind = Number(behindRaw)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null
  return { ahead, behind, upstreamGone: false }
}

/** 最后一次提交。只有详情页要这一条——列表页为此多起一次 git.exe 不值得。 */
export const readLastCommit: CommitInspector = async (
  path: string,
  options: InspectOptions,
): Promise<CommitFacts | null> => {
  const result = await probe(
    ['log', '-1', '--no-merges', `--format=%h${FIELD}%s${FIELD}%an${FIELD}%cI`],
    cwd(path, options),
  )
  if (!result.ok) return null
  const [hash, subject, author, date] = result.stdout.trim().split(FIELD)
  if (!hash) return null
  return { hash, subject: subject ?? '', author: author ?? '', date: date ?? '' }
}

/**
 * `git merge-base --is-ancestor <a> <b>`：a 是不是 b 的祖先？
 *
 * 退出码语义（实测确认）：0 = 是，1 = 不是，其它 = 出错。
 * 只有 1 才是「确定不是」，其它失败返回 null——**不敢下结论时不下结论**。
 *
 * 这一条与 `readHasCommonAncestor` 就是「推不推荐更新」的全部额外成本：
 * ahead/behind 由 `readDivergence` 提供，判决本身是纯函数（`recommend.ts` 的
 * `applyVerdict`），不再重复起进程。
 */
export async function readIsAncestor(
  path: string,
  ancestor: string,
  descendant: string,
  options: InspectOptions,
): Promise<boolean | null> {
  const result = await probe(
    ['merge-base', '--is-ancestor', ancestor, descendant],
    cwd(path, options),
  )
  if (result.ok) return true
  return result.result.code === 1 ? false : null
}

/**
 * 两个历史还有没有共同祖先？`merge-base` 输出为空 = 没有。
 *
 * 这是「作者重置/重建了仓库」的判据：本地那棵树和上游那棵树**一点关系都没有**，
 * 拉进来等于换一个仓库，本地的东西全成孤儿。
 */
export async function readHasCommonAncestor(
  path: string,
  options: InspectOptions,
): Promise<boolean | null> {
  const result = await probe(['merge-base', 'HEAD', '@{u}'], cwd(path, options))
  if (result.ok) return result.stdout.trim().length > 0
  // exit 1 是 git 表达「没有共同祖先」的方式，不是错误
  return result.result.code === 1 ? false : null
}

function cwd(path: string, options: InspectOptions): RunOptions {
  return { cwd: path, timeoutMs: options.timeoutMs, label: options.label ?? 'status' }
}
