import { probe, runGit, toGitError, type RunOptions } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import type { GitLogEntry } from './types.ts'

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

export interface UpdateReportEntry {
  shortHash: string
  subject: string
  author: string
  date: string
}

export interface UpdateReport {
  status: import('./types.ts').UpdateStatus
  ahead: number | null
  behind: number | null
  /** 远程有、本地没有的提交（要拉进来的） */
  incoming: UpdateReportEntry[]
  /** 本地有、远程没有的提交 */
  outgoing: UpdateReportEntry[]
  tags: string[]
  error: import('./types.ts').GitError | null
}

/**
 * fetch 之后看远程比本地多了什么。只动 refs/remotes/*，不碰工作区。
 * M3 的批量检查更新会复用这个函数。
 */
export async function analyzeUpdates(path: string, options: LogOptions = {}): Promise<UpdateReport> {
  const scheduler = options.scheduler ?? defaultScheduler
  return scheduler.schedule(path, async () => {
    const cwd = { cwd: path, timeoutMs: options.timeoutMs }

    // 只动 refs/remotes/*，不碰工作区
    const fetch = await runGit(['fetch', '--prune', 'origin'], cwd)
    if (fetch.code !== 0) {
      return {
        status: 'error',
        ahead: null,
        behind: null,
        incoming: [],
        outgoing: [],
        tags: [],
        error: toGitError(fetch, 'fetch 失败'),
      }
    }

    const upstream = await probe(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
    if (!upstream.ok) {
      return {
        status: 'no_upstream',
        ahead: null,
        behind: null,
        incoming: [],
        outgoing: [],
        tags: [],
        error: null,
      }
    }
    const ref = upstream.stdout.trim()

    const counts = await probe(['rev-list', '--left-right', '--count', `HEAD...${ref}`], cwd)
    const [ahead, behind] = counts.ok
      ? counts.stdout.trim().split(/\s+/).map((n) => Number(n))
      : [null, null]

    const range = `${ref}..HEAD`
    const incomingRaw = await probe(
      ['log', range, '-n', '50', '--date=iso-strict', '--pretty=format:%h%x1f%s%x1f%an%x1f%cI'],
      cwd,
    )
    const incoming = incomingRaw.ok ? parseReportEntries(incomingRaw.stdout) : []

    const tags = await listRemoteTags(cwd)

    return {
      status:
        ahead && behind
          ? 'diverged'
          : behind
            ? 'behind'
            : ahead
              ? 'ahead'
              : 'up_to_date',
      ahead: ahead ?? null,
      behind: behind ?? null,
      incoming,
      outgoing: [],
      tags,
      error: null,
    }
  })
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

/** fetch 之后新出现的 tag：本地 refs/tags 里没有、远程有的。 */
async function listRemoteTags(cwd: { cwd: string; timeoutMs?: number }): Promise<string[]> {
  const local = await probe(['tag', '--list'], cwd)
  const localSet = new Set(local.ok ? local.stdout.split('\n').map((t) => t.trim()) : [])

  const ls = await probe(['ls-remote', '--tags', '--refs', 'origin'], cwd)
  if (!ls.ok) return []

  const remote: string[] = []
  for (const line of ls.stdout.split('\n')) {
    const m = /refs\/tags\/(.+)$/.exec(line.trim())
    const name = m?.[1]
    if (name && !localSet.has(name)) remote.push(name)
  }
  return remote
}
