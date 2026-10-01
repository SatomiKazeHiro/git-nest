import { probe, runGit, toGitError, type RunOptions } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import type { GitLogEntry, UpdateReport, UpdateReportEntry, UpdateStatus } from './types.ts'

/**
 * 提交图数据。字段用 0x1F（单元分隔）隔开、记录用 0x1E（记录分隔），
 * 这样 message 里出现任何字符都不会串行。
 *
 * 字段顺序与 `parseGitLog` 的解析一一对应，改动时两边一起改。
 * `%cI` 是 committer date、`%aI` 是 author date：提交图组件两个都要
 * （rebase/amend 之后它们会不一样）。
 */
const PRETTY = [
  '--pretty=format:%H',
  '%x1f%h',
  '%x1f%P',
  '%x1f%an',
  '%x1f%ae',
  '%x1f%cI',
  '%x1f%aI',
  '%x1f%s',
  '%x1f%D',
  '%x1e',
].join('')

const FIELD = '\x1f'
const RECORD = '\x1e'

export interface LogOptions extends Partial<RunOptions> {
  maxCount?: number
  scheduler?: Scheduler
  /**
   * 只取这个分支的历史（`git log <branch>`）。
   *
   * 默认 `HEAD`：**不取 --all**。提交图组件按 `branch` 组织图，而 `--all` 会
   * 把别的分支的提交也拉进来，同一个提交还可能属于多个分支，归属说不清。
   * 这个视图看的就是当前检出的那条线。
   */
  branch?: string
}

/** 解析 `git log --pretty` 的输出，喂给泳道图组件。 */
export function parseGitLog(raw: string, branch = 'HEAD'): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const chunk of raw.split(RECORD)) {
    const line = chunk.replace(/^[\r\n]+/, '')
    if (!line.trim()) continue
    const [
      hash,
      shortHash,
      parents,
      authorName,
      authorEmail,
      committerDate,
      authorDate,
      subject,
      refs,
    ] = line.split(FIELD)
    if (!hash) continue
    const date = committerDate ?? ''
    entries.push({
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      parents: (parents ?? '').trim() ? parents!.trim().split(/\s+/) : [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      date,
      /** 提交图组件要的两个时间戳 */
      committerDate: date,
      authorDate: authorDate ?? date,
      /** 这个提交属于哪条分支：本视图只看一条线，所以就是它 */
      branch,
      subject: subject ?? '',
      refs: (refs ?? '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    })
  }
  return entries
}

export async function getLog(path: string, options: LogOptions = {}): Promise<GitLogEntry[]> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.schedule(path, async () => {
    const branch = options.branch ?? 'HEAD'
    const args = ['log', branch, '-n', String(options.maxCount ?? 200)]
    args.push('--date=iso-strict', PRETTY)
    const result = await probe(args, { cwd: path, timeoutMs: options.timeoutMs })
    if (!result.ok) {
      // 空仓库 / 不是仓库：给空列表，让 UI 显示「还没有提交」而不是报错
      return []
    }
    return parseGitLog(result.stdout, branch)
  })
}

/**
 * fetch 之后看远程比本地多了什么。只动 refs/remotes/*，不碰工作区。
 * M3 的批量检查更新会复用这个函数。
 *
 * 注意：incoming 用 `HEAD..@{u}`（远程有、本地没有），outgoing 用 `@{u}..HEAD`。
 * 这两个范围写反了会把「本地没推的」当成「要拉的」，面板上就全反了。
 */
export async function analyzeUpdates(path: string, options: LogOptions = {}): Promise<UpdateReport> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.schedule(path, async () => {
    const cwd = { cwd: path, timeoutMs: options.timeoutMs }

    // 有没有 origin？没有就别去 fetch —— git 会报一堆看着像网络问题的错。
    // 这一条也顺带回答了「是不是仓库」：非仓库目录里 `git remote` 会失败。
    //
    // 注意不能用 `remote get-url origin` 代替：没有 origin 时它会报
    // 「No such remote 'origin'」，归因不出「没有远程」这个**常态**。
    const remote = await probe(['remote'], cwd)
    if (!remote.ok) {
      const err = toGitError(remote.result, '这个目录不是 git 仓库')
      return err.kind === 'not_a_repo' ? emptyReport('not_a_repo') : { ...emptyReport('error'), error: err }
    }
    const hasOrigin = remote.stdout.split('\n').some((l) => l.trim() === 'origin')
    if (!hasOrigin) return emptyReport('no_remote')

    const localTagsBefore = new Set(await listTags(cwd))

    // 只动 refs/remotes/*，不碰工作区
    const fetch = await runGit(['fetch', '--prune', 'origin'], cwd)
    if (fetch.code !== 0) {
      const error = toGitError(fetch, 'fetch 失败')
      return { ...emptyReport('error'), error }
    }

    // 领先/落后：一条 `rev-list` 就够，而且它**自己**就能回答「有没有上游」——
    // `HEAD...@{u}` 在上游不存在时直接失败。原来这里先探一次 `@{u}` 再跑 rev-list，
    // 等于为同一件事起两个进程。
    // 区分两类失败：上游不存在（no_upstream，常态）vs 读不出来（error）。
    const counts = await probe(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd)
    if (!counts.ok) {
      const combined = `${counts.result.stderr}\n${counts.result.stdout}`
      if (/unknown revision|no such|does not have a branch|no upstream|ambiguous argument/i.test(combined)) {
        return emptyReport('no_upstream')
      }
      // 探测失败 ≠ 「没有差异」。以前这里把失败当成 ahead/behind 双 null，
      // 三元链一路落到 'up_to_date'，于是把一个**根本没读成功**的仓库
      // 报成「已是最新」且 error 为 null —— 最危险的假绿方向。
      const error = toGitError(counts.result, '读不到本地与远程的差异')
      return { ...emptyReport('error'), error }
    }

    const parts = counts.stdout.trim().split(/\s+/)
    const ahead = Number(parts[0])
    const behind = Number(parts[1])
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
      return {
        ...emptyReport('error'),
        error: {
          kind: 'unknown',
          message: `rev-list 的输出读不懂：${counts.stdout.trim().slice(0, 80)}`,
        },
      }
    }

    // incoming = 远程有本地没有（要拉进来的）；outgoing = 本地有远程没有（还没推的）
    // 直接用 `@{u}`，省掉「先 rev-parse 出上游全名」那一次进程。
    const incoming = await readRange(cwd, 'HEAD..@{u}', 50)
    const outgoing = await readRange(cwd, '@{u}..HEAD', 50)

    // fetch 之后新出现的 tag：本地 refs/tags 里没有的
    const localTagsAfter = new Set(await listTags(cwd))
    const newTags = [...localTagsAfter].filter((t) => !localTagsBefore.has(t))

    return {
      status: statusFromCounts(ahead, behind),
      ahead,
      behind,
      incoming,
      outgoing,
      tags: newTags,
      error: null,
    }
  })
}

/**
 * ahead/behind 两个数字 → 状态。显式比较，不再依赖 null 的假值语义
 * （与 `deriveStatus` 保持一致）。
 */
export function statusFromCounts(ahead: number, behind: number): UpdateStatus {
  if (ahead > 0 && behind > 0) return 'diverged'
  if (behind > 0) return 'behind'
  if (ahead > 0) return 'ahead'
  return 'up_to_date'
}

async function readRange(
  cwd: { cwd: string; timeoutMs?: number },
  range: string,
  max: number,
): Promise<UpdateReportEntry[]> {
  const result = await probe(
    ['log', range, '-n', String(max), '--date=iso-strict', '--pretty=format:%h%x1f%s%x1f%an%x1f%cI'],
    cwd,
  )
  return result.ok ? parseReportEntries(result.stdout) : []
}

function emptyReport(status: UpdateReport['status']): UpdateReport {
  return {
    status,
    ahead: null,
    behind: null,
    incoming: [],
    outgoing: [],
    tags: [],
    error: null,
  }
}

async function listTags(cwd: { cwd: string; timeoutMs?: number }): Promise<string[]> {
  const result = await probe(['tag', '--list'], cwd)
  return result.ok
    ? result.stdout
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
    : []
}

function parseReportEntries(raw: string): UpdateReportEntry[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [shortHash = '', subject = '', author = '', date = ''] = line.split('\x1f')
      return { shortHash, subject, author, date }
    })
}
