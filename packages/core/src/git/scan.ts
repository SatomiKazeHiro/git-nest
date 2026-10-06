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
  /**
   * 最多**列给用户看**多少个仓库，缺省 `DEFAULT_MAX_RESULTS`。
   *
   * 为什么要有上限：每找到一个候选仓库都要问两次 git（origin、没有 README 时再问一次
   * 最后一次提交），而扫描的范围完全由用户填的那个目录决定——随手填一个盘根目录 +
   * depth 3 就是几千个候选、上万次 git 进程，界面上只有一个「扫描中…」，也没有取消。
   * 超出的部分**不静默丢掉**：`truncated` / `candidates` 如实报出去，让界面说清
   * 「只列了前 N 个」。
   */
  maxResults?: number
}

/** 一次扫描最多列出的仓库数（正常用法碰不到；它只是把「随手扫整个盘」的工作量封顶） */
export const DEFAULT_MAX_RESULTS = 500

const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'README', 'README.txt']

/** 摘要只取 60 个字符，读超过这个大小的 README 是纯浪费（2MB 足够装下任何正经说明） */
const MAX_README_BYTES = 2 * 1024 * 1024

/**
 * 扫一层子目录，找出 git 仓库。
 * `.git` 是目录或文件都算——worktree 与 submodule 的 `.git` 是文件。
 *
 * **全程异步 IO**（`fs.promises`）：扫描是递归遍历，一个同步的 readdir/stat 就把事件循环
 * 按住了——而这个服务同时还在跑别的仓库的 git、还在推 SSE 进度，用户还可能填了一个
 * 很大的目录。同一棵目录树，改异步之后墙钟时间不变，但期间服务不会僵住。
 */
export async function scanDirectory(dir: string, options: ScanOptions = {}): Promise<ScanResult> {
  const scheduler = options.scheduler ?? defaultScheduler
  const depth = options.maxDepth ?? 1
  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS)
  const tracked = new Set([...(options.trackedPaths ?? [])].map(comparisonKey))

  const walk = await findRepoDirs(dir, depth, maxResults)
  const found = await scheduler.map(walk.dirs, (d) => d, (d) => describeRepo(d, tracked, options))

  return {
    dir: normalize(dir),
    found: found.filter((r): r is ScannedRepo => r !== null),
    candidates: walk.candidates,
    truncated: walk.truncated,
  }
}

interface WalkResult {
  dirs: string[]
  /** 一共发现多少个仓库目录（可能多于 dirs.length） */
  candidates: number
  /** 是否因为 maxResults 而少列了 */
  truncated: boolean
}

async function findRepoDirs(root: string, depth: number, maxResults: number): Promise<WalkResult> {
  const dirs: string[] = []
  let candidates = 0
  let truncated = false

  const walk = async (current: string, level: number): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      // 读不了就跳过（没有权限、路径太长、扫到一半被删…）。
      // 扫描是只读预览，一个子目录读不了不该让整次扫描失败。
      return
    }

    // 逐层排序：两次扫描的顺序必须一致，用户才能比对（最终结果还会整体排一次）
    const children = entries
      .filter(
        (entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'),
      )
      .map((entry) => path.join(current, entry.name))
      .sort((a, b) => a.localeCompare(b))

    for (const full of children) {
      if (await isGitRepo(full)) {
        candidates += 1
        if (dirs.length < maxResults) dirs.push(full)
        else truncated = true
        continue // 仓库内部不再下钻
      }
      if (level < depth) await walk(full, level + 1)
    }
  }

  await walk(root, 1)
  // 与改造前逐字节一致：按完整路径排序（服务端还会再排一次，这里保住 core 自己的契约）
  return { dirs: dirs.sort((a, b) => a.localeCompare(b)), candidates, truncated }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    // stat（不是 lstat）：跟着符号链接走，与改造前的 existsSync 一致
    await fs.promises.stat(path.join(dir, '.git'))
    return true
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

  const readme = await readReadmeSummary(dir)
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
    alreadyTracked: tracked.has(comparisonKey(dir)),
  }
}

/** README 首段：跳过标题徽章、HTML 注释与空行。 */
async function readReadmeSummary(dir: string): Promise<string | null> {
  for (const name of README_NAMES) {
    const file = path.join(dir, name)
    let text: string
    try {
      const stat = await fs.promises.stat(file)
      if (!stat.isFile()) continue
      // 别为了 60 个字的摘要把几百 MB 的文件读进内存（数据仓库里真有人放这么大的 README）
      if (stat.size > MAX_README_BYTES) continue
      text = await fs.promises.readFile(file, 'utf8')
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

/** 路径存成统一形式：正斜杠、不带尾斜杠。**保留大小写**——这是要入库的路径，
 * 被 lower 之后清单里就会出现 `c:/users/...`，与用户手输的路径对不上，去重也会失效。 */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

/** 比较用的 key：Windows 上路径不区分大小写，判断「是不是同一个」时忽略它。 */
function comparisonKey(p: string): string {
  return normalize(p).toLowerCase()
}
