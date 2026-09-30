import fs from 'node:fs'
import path from 'node:path'
import { probe } from './runner.ts'
import { defaultScheduler, type Scheduler } from './scheduler.ts'
import type { ScanResult, ScannedRepo } from './types.ts'

export interface ScanOptions {
  maxDepth?: number
  scheduler?: Scheduler
  timeoutMs?: number
  /** 已经在清单里的路径，小写斜杠形式，用于标记 alreadyTracked */
  trackedPaths?: Iterable<string>
}

const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'README', 'README.txt']

/**
 * 扫一层子目录，找出 git 仓库。
 * `.git` 是目录或文件都算——worktree 与 submodule 的 `.git` 是文件。
 */
export async function scanDirectory(dir: string, options: ScanOptions = {}): Promise<ScanResult> {
  const scheduler = options.scheduler ?? defaultScheduler
  const depth = options.maxDepth ?? 1
  const tracked = new Set([...(options.trackedPaths ?? [])].map(normalize))

  const candidates = findRepoDirs(dir, depth)
  const found = await scheduler.map(candidates, (d) => d, (d) => describeRepo(d, tracked, options))

  return { dir: normalize(dir), found: found.filter((r): r is ScannedRepo => r !== null) }
}

function findRepoDirs(root: string, depth: number): string[] {
  const out: string[] = []
  const walk = (current: string, level: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (isGitRepo(full)) {
        out.push(full)
        continue // 仓库内部不再下钻
      }
      if (level < depth) walk(full, level + 1)
    }
  }
  walk(root, 1)
  return out.sort((a, b) => a.localeCompare(b))
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'))
  } catch {
    return false
  }
}

async function describeRepo(
  dir: string,
  tracked: Set<string>,
  options: ScanOptions,
): Promise<ScannedRepo | null> {
  const cwd = { cwd: dir, timeoutMs: options.timeoutMs }
  const remote = await probe(['remote', 'get-url', 'origin'], cwd)
  const remoteUrl = remote.ok ? remote.stdout.trim() : null

  const readme = readReadmeSummary(dir)
  let summary = readme
  let summarySource: ScannedRepo['summarySource'] = readme ? 'readme' : 'none'

  if (!summary) {
    const subject = await probe(['log', '-1', '--format=%s'], cwd)
    if (subject.ok && subject.stdout.trim()) {
      summary = subject.stdout.trim().slice(0, 60)
      summarySource = 'commit'
    }
  }

  return {
    dir: normalize(dir),
    name: path.basename(dir),
    remoteUrl,
    summary: summary ? summary.slice(0, 60) : null,
    summarySource,
    alreadyTracked: tracked.has(normalize(dir)),
  }
}

/** README 首段：跳过标题徽章、HTML 注释与空行。 */
function readReadmeSummary(dir: string): string | null {
  for (const name of README_NAMES) {
    const file = path.join(dir, name)
    let text: string
    try {
      if (!fs.statSync(file).isFile()) continue
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const summary = firstParagraph(text)
    if (summary) return summary
  }
  return null
}

function firstParagraph(markdown: string): string | null {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const lines = withoutComments.split(/\r?\n/)

  const collected: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      if (collected.length > 0) break
      continue
    }
    if (t.startsWith('#') || t.startsWith('![') || t.startsWith('[![') || t.startsWith('<img')) continue
    if (/^[-=*_]{3,}$/.test(t)) continue
    if (t.startsWith('>') || t.startsWith('|') || t.startsWith('```')) continue
    collected.push(t)
  }
  const text = collected.join(' ').replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').trim()
  return text.length > 0 ? text.slice(0, 60) : null
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}
