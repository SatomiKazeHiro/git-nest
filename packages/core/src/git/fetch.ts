import { DEFAULT_TIMEOUT_MS, probe, toGitError, type GitResult, type RunOptions } from './runner.ts'
import type { GitError, GitErrorKind } from './types.ts'

/**
 * 取远程事实：**这个模块是整个 core 里唯一跑 `git fetch` 的地方**（`pull` 内部
 * 那一次自带 fetch 除外，那一下不在我们手里）。
 *
 * 为什么要有它：某个项目的 origin 是 HTTPS，`git fetch` 报
 * `Recv failure: Connection was reset` / `Failed to connect to github.com port 443`，
 * 而**同一分钟**别的用 SSH 的项目 fetch 成功——同一个 GitHub、同一条网络，
 * 差别只在走哪条路（HTTPS/443 被掐、SSH/22 通）。所以「取远程事实」这件事
 * 应当**按项目自动换传输方式**，而不是把一次失败直接写成结论。
 *
 * 这里要防的那个**假结论**很具体：换路之后只更新了 `FETCH_HEAD`，而 `@{u}`、
 * `origin/main`、`--prune` 判「上游被删」全靠 `refs/remotes/origin/*` ——
 * 于是「fetch 成功了」但分析看到的是旧 refs，把「已是最新」写进 `update_checks`。
 * 所以每一次 fetch 都带**显式 refspec**（见 `FETCH_REFSPEC`）。
 *
 * 层级约定：core 碰不到数据库，所以「记住这个项目走通了哪条路」不在这里做——这里只把
 * 结论**交出去**（返回值里的 `transport` / `onResolved` 回调），落库与下次把
 * `preferred` 传进来都是 server 的事（`apps/server/src/repos/transports.ts`）。
 */

/**
 * 传输方式。只有这两种能自动互换，别的（本地路径、git://、HTTP 镜像）不碰。
 *
 * **运行时数组是权威，类型从它推出来**：server 要拿它当 `project_transports` 表的
 * 合法值白名单（那是个字符串列，库层校验不了类型）。曾经那份白名单是手抄的
 * `['https', 'ssh']`，加第三种传输方式时类型会变、白名单不会——于是新值被静默拒收。
 */
export const REMOTE_TRANSPORTS = ['https', 'ssh'] as const

export type RemoteTransport = (typeof REMOTE_TRANSPORTS)[number]

/**
 * `classifyError` 给的那些种类里，**哪些在「取远程事实」这件事上说得通**。
 *
 * 其余（`locked` / `path_too_long` / `not_a_repo` / `missing`）与传输方式毫无关系：
 * 它们不是「这条路不通」，而是「这个仓库现在不能 fetch」。这类结果统一记成
 * `fetch_failed`（`types.ts` 里为了这件事加的那个种类）——**绝不冒充 `network`**，
 * 否则会为了一个跟网络无关的原因白跑第二次 fetch。
 */
const FETCH_RELEVANT_KINDS: readonly GitErrorKind[] = ['network', 'auth', 'timeout']

/**
 * **每一次** fetch 都要带的 refspec。
 *
 * 只给 URL 的 `git fetch <url>` **只更新 `FETCH_HEAD`**，不会动
 * `refs/remotes/origin/*`；而 `@{u}`、`origin/main`、`--prune` 判「上游被删」
 * 全依赖那些 ref。换传输方式时不带这个 refspec，就会「fetch 成功、分析看不见」
 * ——比 fetch 失败更坏：失败至少是诚实的。
 *
 * 左边 `+` = 允许非快进更新（远程被 force push 是常态，不加它会直接拒绝更新）；
 * 右边固定映射到 `origin`：本模块服务的语义就是「把 origin 的远程事实取回来」，
 * 与 `git fetch origin` 一致。这是命令行参数，**不写任何仓库配置**
 * （不 `remote set-url`、不碰 `.git/config`），用户仓库的 remote 保持原样。
 */
export const FETCH_REFSPEC = '+refs/heads/*:refs/remotes/origin/*'

/**
 * 换路重试的超时上限（**毫秒**）。
 *
 * git 没有 connect-timeout 旋钮，我们自己的超时是唯一兜底。实测那条 HTTPS 失败
 * 花了 **21 秒**（`Failed to connect to github.com port 443 after 21081 ms`），
 * 所以重试必须**比主路径更短**：否则最坏情况从 21 秒变成 42 秒，而用户什么都还没看到。
 * 主路径已经把时间花掉了，第二条路只给这点预算——它多半是「立刻通」或「立刻拒」。
 */
const FALLBACK_TIMEOUT_MAX_MS = 15_000

/** 再短的超时就不是「给它一次机会」了，是一上手就掐（本地 SSH 握手也要几百毫秒）。 */
const FALLBACK_TIMEOUT_MIN_MS = 3_000

/**
 * 两条路各自可互换的 URL 形式。**只认 GitHub 的规范地址**：
 * 「非 github / 本来就不可转 → null」是硬要求，猜错主机名比不换路坏得多。
 */
const GITHUB_HTTPS = /^https?:\/\/(?:www\.)?github\.com\/(.+)$/i
const GITHUB_SSH = /^(?:[^@/]+@)?github\.com:(.+)$/i

/**
 * 同一个仓库的另一条传输方式（纯函数，不碰网络、不碰配置）。
 *
 * - `https://github.com/o/r(.git)` → `git@github.com:o/r.git`
 * - `git@github.com:o/r(.git)` → `https://github.com/o/r.git`
 * - 非 github（自建 GitLab、本地路径、`git://`、镜像）→ `null`
 * - 认不出「owner/repo」→ `null`
 *
 * 输出**总是**规范形式（SSH 带 `git@`、两边都带 `.git`），所以它是幂等的：
 * 喂 `deriveAlternativeRemote` 自己的输出只会得到另一条路，不会原地打转。
 *
 * 故意**不解析 `url.<base>.insteadOf` 重写**：那是「git 真正会用的地址」
 * （`readRemoteUrl` 读的那一个），我们只要认清这条地址属于哪条路就够；
 * 而换路时把 URL 显式给 git，也决定了 insteadOf 不会再改写新地址的形式。
 */
export function deriveAlternativeRemote(url: string): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null

  const https = GITHUB_HTTPS.exec(raw)
  if (https) {
    const slug = repoSlug(https[1] ?? '')
    return slug ? `git@github.com:${slug}.git` : null
  }

  const ssh = GITHUB_SSH.exec(raw)
  if (ssh) {
    const slug = repoSlug(ssh[1] ?? '')
    return slug ? `https://github.com/${slug}.git` : null
  }

  return null
}

/**
 * `owner/repo.git` / `owner/repo` / `owner/repo/` → `owner/repo`；
 * **多一段就不认**（给 null）。
 *
 * 为什么严格要求「正好两段」：`https://github.com/o/r/tree/main` 这类**网页地址**
 * 只取前两段也能得到 `o/r`，看起来「猜对了」——但把网页地址交给 git 当 remote 用
 * 是另一回事，而且网页地址的形态不止一种（issues / blob / releases…），
 * 猜错一次的代价是**换到一条根本不存在的路**上，比不换路坏得多。
 * 判据必须是确定的：不是规范 remote 形态就不动。
 */
function repoSlug(pathPart: string): string | null {
  const cleaned = pathPart
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

export interface FetchRemoteOptions {
  /** 仓库目录 */
  dir: string
  /**
   * 要 fetch 的地址。**必须显式给**，不用裸 `origin`：
   * 一次「换传输方式」的 fetch 本来就带着另一条 URL，用远程名换不了路。
   */
  url: string
  /** 这次走哪条路。只用于「选哪条路跑通了」与错误提示，`git` 自己按 URL 判断。 */
  transport: RemoteTransport
  timeoutMs?: number
  label?: string
}

/** 一次 fetch 的结果。**失败不抛异常**：调用方要能拿到另一个传输方式再试一次。 */
export type FetchRemoteResult =
  | { ok: true; code: 0; stderr: string; timedOut: false }
  | { ok: false; code: number; stderr: string; timedOut: boolean; error: GitError }

/**
 * 「真的去跑一次 fetch」这件事本身，**可注入**。
 *
 * 为什么要有这个接缝：「换路」的判据是**网络事实**（这条通、那条不通），而测试
 * 不该依赖真实网络——那台机器的环境可能正好是 github:443 通 / SSH 不通，
 * 于是「两条路都失败」根本不成立，测试变成了随机红绿。注入之后，
 * 「哪条路被先试、试了几次、超时给的是哪一档」都变成确定性的断言，
 * 而「命令怎么拼、refs 有没有真的前进」照旧由真 git 的集成用例钉着
 * （那一条**不能**用假执行器代替，否则就成了自己验自己）。
 *
 * 缺省就是 `fetchRemote` 本身：生产路径上没有任何分支差异。
 */
export type FetchExecutor = (options: FetchRemoteOptions) => Promise<FetchRemoteResult>

/** 一次尝试的记录。测试用它断言「真的跑了两次」，用户用它看「哪条路失败了」。 */
export interface FetchAttempt {
  transport: RemoteTransport
  url: string
  code: number
  timedOut: boolean
  /** 失败时的归因；成功时没有 */
  error?: GitError
}

export interface FetchWithFallbackOptions {
  dir: string
  /** 这个项目的 origin 地址（`readRemoteUrl` 读出来的那个） */
  url: string
  /**
   * 上次走通的那条路（由 server 从 `project_transports` 读出来传进来）。
   * `null` = 还没有结论，按地址本身的形式先试。
   *
   * core 不认识数据库，所以「记住」只在调用方——这里只负责**先试它**：
   * 上次证明了这条路在这个项目、这条网络上能用，就别每次重新踩一遍 21 秒的超时。
   */
  preferred?: RemoteTransport | null
  timeoutMs?: number
  label?: string
  /**
   * 这次 fetch **真的跑通了**哪条传输方式（只在这一刻回调一次；两次都失败、或者
   * 换了路但同样失败时都不回调）。
   *
   * 为什么用回调而不是塞进返回值：调用方（server）要的只是「把这条结论记住」，
   * 而它必须只在**确实走通了**的时候发生——让 core 在那一刻说一声，
   * 调用方就不必去猜 `attempts` 里哪一条才算数，也不必为它改返回形状。
   */
  onResolved?: (transport: RemoteTransport) => void
  /** 换掉「真的去跑 fetch」那一层（测试接缝，见 `FetchExecutor`）。缺省跑真 git。 */
  execute?: FetchExecutor
}

export interface FetchWithFallbackResult {
  ok: boolean
  /** 这次真的跑通的传输方式（早退或两条都失败时是 null）。**要靠它记住这个项目走哪条路** */
  transport: RemoteTransport | null
  /** 按顺序尝试过的每一次：`attempts.length > 1` 就是「换过路」的铁证 */
  attempts: FetchAttempt[]
  /** 全部失败时的归因（两条路的归因不同时，两条都会写在 `message` 里） */
  error: GitError | null
}

/**
 * 跑一次 fetch：`git fetch --prune <alt-url> "+refs/heads/*:refs/remotes/origin/*"`。
 *
 * 归因**复用** `toGitError` → `classifyError`，不另写一套正则；只把那些与
 * 「这条传输方式通不通」无关的种类收成 `fetch_failed`（见 `FETCH_RELEVANT_KINDS`）。
 */
export async function fetchRemote(options: FetchRemoteOptions): Promise<FetchRemoteResult> {
  const runOptions: RunOptions = {
    cwd: options.dir,
    // 显式地址 + 显式 refspec：只动 refs/remotes/origin/*，不碰工作区、不写仓库配置
    timeoutMs: options.timeoutMs,
    ...(options.label ? { label: options.label } : {}),
  }

  // 用 probe（而不是 runGit）：失败时连结果对象一起拿到，正好喂给 toGitError
  const result = await probe(['fetch', '--prune', options.url, FETCH_REFSPEC], runOptions)
  if (result.ok) {
    return { ok: true, code: 0, stderr: '', timedOut: false }
  }

  return {
    ok: false,
    code: result.result.code,
    stderr: result.result.stderr,
    timedOut: result.result.timedOut,
    error: fetchFailure(result.result),
  }
}

/**
 * 先试记住的那条，失败**且归因是 network** 时换另一条再试一次。
 *
 * 两条边界是刻意的：
 *
 * 1. **只有 `network` 自动换路。** `auth` 是「这条路走不通」而不是「这条路连不上」
 *    ——私有仓库在 HTTPS 上要凭据、在 SSH 上要 key，两条都要用户动手，
 *    自动重试只是让他多等一次，所以他得到的是一条**写在错误文案里**的建议。
 *    别的种类（locked / timeout / missing）与传输方式无关，重试没有意义。
 * 2. **重试的超时比主路径短**（`fallbackTimeoutMs`）：21 秒的连接超时如果再来一次，
 *    最坏情况就是 42 秒——用户会觉得软件死了。
 */
export async function fetchWithFallback(
  options: FetchWithFallbackOptions,
): Promise<FetchWithFallbackResult> {
  const altUrl = deriveAlternativeRemote(options.url)
  // **主路径永远是 origin 现在那个地址**（它才是用户配的那条路）。
  // 记住的 preferred 只在它是**另一条路**、且那条路算得出来时才先试：
  // 用户可能改了 remote（换仓库 / 换主机），那时不能再按老习惯先踩一次错的。
  const primary: RemoteTransport = transportOf(options.url)
  const usePreferred = options.preferred === otherTransport(primary) && altUrl !== null
  const firstTransport: RemoteTransport = usePreferred ? options.preferred! : primary
  const firstUrl = usePreferred ? altUrl! : options.url
  // 缺省就是真 git；测试接缝只替换「怎么去跑」，不改变任何判断顺序
  const execute = options.execute ?? fetchRemote

  const label = options.label
  const first = await execute({
    dir: options.dir,
    url: firstUrl,
    transport: firstTransport,
    // 走的是记住的那条时，它已经算「第二条路」了：给它换路那一档的超时
    timeoutMs: usePreferred ? fallbackTimeoutMs(options.timeoutMs) : options.timeoutMs,
    ...(label ? { label } : {}),
  })
  const attempts: FetchAttempt[] = [attemptOf(firstTransport, firstUrl, first)]

  if (first.ok) {
    options.onResolved?.(firstTransport)
    return { ok: true, transport: firstTransport, attempts, error: null }
  }

  const shouldRetry =
    first.error.kind === 'network' && altUrl !== null && !sameUrl(altUrl, firstUrl)
  if (!shouldRetry) {
    return {
      ok: false,
      transport: null,
      attempts,
      error: withOtherRouteHint(first.error, firstTransport, altUrl, attempts.length),
    }
  }

  const secondTransport = otherTransport(firstTransport)
  const second = await execute({
    dir: options.dir,
    url: altUrl,
    transport: secondTransport,
    timeoutMs: fallbackTimeoutMs(options.timeoutMs),
    ...(label ? { label } : {}),
  })
  attempts.push(attemptOf(secondTransport, altUrl, second))

  if (second.ok) {
    options.onResolved?.(secondTransport)
    return { ok: true, transport: secondTransport, attempts, error: null }
  }

  return {
    ok: false,
    transport: null,
    attempts,
    // 两条都没通：归因要**同时**交代这两次，不能只留一条（见 `composeFetchFailure`）
    error: withOtherRouteHint(
      composeFetchFailure(attempts),
      firstTransport,
      altUrl,
      attempts.length,
    ),
  }
}

type FailedAttempt = FetchAttempt & { error: GitError }

function isFailed(attempt: FetchAttempt): attempt is FailedAttempt {
  return attempt.error !== undefined
}

/**
 * 两条路都失败时的错误文案。
 *
 * 为什么不能只取主路径那一条：记住的 preferred 一旦过时（用户换了网络、或者那条路
 * 只是临时抽风），先试的失败者就成了「主路径」，于是用户看到「SSH 认证失败」，
 * 而真正的原因可能是 HTTPS 也连不上。只说一半比不说更坏——他会去修错的 set。
 *
 * 去重的判据是**文案**而不是归因种类：两条路都报「连不上」时写两遍是噪音，
 * 但同一归因下文案不同（例如两条路各自有不同的 stderr 首行）是有信息的，
 * 不能因为 kind 相同就丢掉第二条。
 *
 * 返回的 `kind` 取**主路径**那一次：它是「这个项目怎么了」的答案；
 * 第二条路只补充文案。
 */
export function composeFetchFailure(attempts: FetchAttempt[]): GitError {
  const failed = attempts.filter(isFailed)
  const main = failed[0]
  if (!main) return { kind: 'unknown', message: 'fetch 失败' }

  const distinct = failed
    .slice(1)
    .filter((a) => a.error.kind !== main.error.kind || a.error.message !== main.error.message)
  if (distinct.length === 0) return main.error

  const parts = [main, ...distinct].map((a) => `${transportLabel(a.transport)}：${a.error.message}`)
  return { ...main.error, message: parts.join('；') }
}

/** 给用户看的方向名。归因文案里出现「哪条路」时才用得上。 */
function transportLabel(transport: RemoteTransport): string {
  return transport === 'https' ? 'HTTPS' : 'SSH'
}

/** 把一次 fetch 结果收成 `FetchAttempt`（成功时没有 error 字段，别塞 undefined）。 */
function attemptOf(
  transport: RemoteTransport,
  url: string,
  result: FetchRemoteResult,
): FetchAttempt {
  const base = { transport, url, code: result.code, timedOut: result.timedOut }
  return result.ok ? base : { ...base, error: result.error }
}

/** fetch 的归因：只取 `classifyError` 给的种类里**与换路有关**的那些。 */
function fetchFailure(result: GitResult): GitError {
  const error = toGitError(result, 'fetch 失败')
  return { ...error, kind: narrowKind(error.kind) }
}

function narrowKind(kind: GitErrorKind): GitErrorKind {
  return FETCH_RELEVANT_KINDS.includes(kind) ? kind : 'fetch_failed'
}

/** URL 本身能看出来的那条路（`https://` / `http://` 都算 HTTPS 这一支）。 */
function transportOf(url: string): RemoteTransport {
  return /^https?:\/\//i.test(url.trim()) ? 'https' : 'ssh'
}

function otherTransport(transport: RemoteTransport): RemoteTransport {
  return transport === 'https' ? 'ssh' : 'https'
}

function sameUrl(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * 换路重试的超时：**比主路径短**，且有明确上限（见 `FALLBACK_TIMEOUT_MAX_MS`）。
 * 主路径没给超时（用 `DEFAULT_TIMEOUT_MS`）时也一样算——不能因为调用方偷懒就把
 * 最坏情况翻倍。
 */
export function fallbackTimeoutMs(timeoutMs?: number): number {
  const main = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const half = Math.floor(main / 2)
  return Math.min(FALLBACK_TIMEOUT_MAX_MS, Math.max(FALLBACK_TIMEOUT_MIN_MS, half))
}

/**
 * 「这条是 HTTPS，若你配了 SSH key，可以用 SSH 再试」——**只在认证失败时**加。
 *
 * 为什么单独写在这里、而不是改 `classifyError`：归因是共用的（status / pull /
 * check 都读它），往里塞 fetch 专属的建议会污染别处；而「另一条路」这个概念
 * 只有 fetch 模块有（它才有 alt URL）。
 *
 * 为什么不给网络失败也加：网络失败**已经被自动换路试过了**，再让用户去手工试
 * 另一条路就是让他白跑一趟；`attempts.length` 会把「试过两条」如实报出去。
 */
export function withOtherRouteHint(
  error: GitError,
  transport: RemoteTransport,
  altUrl: string | null,
  attempts: number,
): GitError {
  if (error.kind !== 'auth' || !altUrl) return error

  const detail = attempts > 1 ? `（已经自动试过另一条路，也失败了）` : ''
  const hint =
    transport === 'https'
      ? `这条是 HTTPS，若你配了 SSH key，可以用 SSH 再试：${altUrl}`
      : `这条是 SSH，若你更习惯 HTTPS，可以用 HTTPS 再试：${altUrl}`

  return { ...error, message: `${error.message}。${detail}${hint}` }
}
