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

/** 脏标记：`git status --porcelain` 一行一个改动文件。 */
export const readWorktree: WorktreeInspector = async (
  path: string,
  options: InspectOptions,
): Promise<WorktreeFacts | null> => {
  const result = await probe(['status', '--porcelain'], cwd(path, options))
  // 读不出来时返回 null，**不能**返回「干净」——那正好是最危险的默认值
  if (!result.ok) return null
  const changeCount = parseDirtyCount(result.stdout)
  return { dirty: changeCount > 0, changeCount }
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

function cwd(path: string, options: InspectOptions): RunOptions {
  return { cwd: path, timeoutMs: options.timeoutMs }
}
