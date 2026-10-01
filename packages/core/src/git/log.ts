import { probe, runGit, toGitError, type RunOptions } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import type { GitLogEntry, UpdateReport, UpdateReportEntry, UpdateStatus } from './types.ts'

/**
 * 提交图数据。字段用 0x1F（单元分隔）隔开、记录用 0x1E（记录分隔），
 * 这样 message 里出现任何字符都不会串行。
 */
const PRETTY = [
  '--pretty=format:%H',
  '%x1f%h',
  '%x1f%P',
  '%x1f%an',
  '%x1f%ae',
  '%x1f%cI',
  '%x1f%s',
  '%x1f%D',
  '%x1e',
].join('')

const FIELD = '\x1f'
const RECORD = '\x1e'

export interface LogOptions extends Partial<RunOptions> {
  maxCount?: number
  scheduler?: Scheduler
  /** 包含所有分支（--all）。默认只要 HEAD。 */
  all?: boolean
}

/** 解析 `git log --pretty` 的输出，喂给泳道图组件。 */
export function parseGitLog(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const chunk of raw.split(RECORD)) {
    const line = chunk.replace(/^[\r\n]+/, '')
    if (!line.trim()) continue
    const [hash, shortHash, parents, authorName, authorEmail, date, subject, refs] =
      line.split(FIELD)
    if (!hash) continue
    entries.push({
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      parents: (parents ?? '').trim() ? parents!.trim().split(/\s+/) : [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      date: date ?? '',
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
    const args = ['log', options.all === false ? 'HEAD' : '--all', '-n', String(options.maxCount ?? 200)]
    args.push('--date=iso-strict', PRETTY)
    const result = await probe(args, { cwd: path, timeoutMs: options.timeoutMs })
    if (!result.ok) {
      // 空仓库 / 不是仓库：给空列表，让 UI 显示「还没有提交」而不是报错
      return []
    }
    return parseGitLog(result.stdout)
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

    // 没有 origin 就别去 fetch 了：git 会报一堆看着像网络问题的错
    // 先确认这是个仓库，再看有没有 origin：
    // 非仓库目录里跑 `git remote` 会报错，不能当成「没有远程」
    const inside = await probe(['rev-parse', '--is-inside-work-tree'], cwd)
    if (!inside.ok || inside.stdout.trim() !== 'true') {
      return emptyReport('not_a_repo')
    }

    const remote = await probe(['remote'], cwd)
    const hasOrigin = remote.ok && remote.stdout.split('\n').some((l) => l.trim() === 'origin')
    if (!hasOrigin) {
      return emptyReport('no_remote')
    }

    const localTagsBefore = new Set(await listTags(cwd))

    // 只动 refs/remotes/*，不碰工作区
    const fetch = await runGit(['fetch', '--prune', 'origin'], cwd)
    if (fetch.code !== 0) {
      const error = toGitError(fetch, 'fetch 失败')
      return { ...emptyReport('error'), error }
    }

    const upstream = await probe(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
    if (!upstream.ok) {
      return emptyReport('no_upstream')
    }
    const ref = upstream.stdout.trim()

    const counts = await probe(['rev-list', '--left-right', '--count', `HEAD...${ref}`], cwd)
    if (!counts.ok) {
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
    const incoming = await readRange(cwd, `HEAD..${ref}`, 50)
    const outgoing = await readRange(cwd, `${ref}..HEAD`, 50)

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
