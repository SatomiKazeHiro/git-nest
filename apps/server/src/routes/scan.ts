import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { MAX_SCAN_RESULTS } from '@git-nest/core'
import type { DB } from '../db/index.ts'
import { badRequest, conflict } from '../lib/errors.ts'
import { getRemoteUrl, scan } from '../lib/git.ts'
import { dirExists, toAbsolutePath } from '../lib/paths.ts'
import { insertProject, nextSortOrder, pathExists } from '../repos/projects.ts'
import { readSettings, writeSettings } from '../lib/settings.ts'

const trimmed = z.string().trim()

/**
 * 一次导入最多几条路径。
 *
 * **必须等于一次扫描最多列出的数量**（core 的 `limits.ts` 里是同一个常量）：
 * 扫描负责「列出候选」、导入负责「把选中的加进清单」，如果扫描能列出 500 而导入
 * 只收 200，用户就会在「全选 → 添加」这一步撞墙，而这堵墙从前端完全看不出来。
 * 现在还多一层保障：前端也读这个常量，超了会提前拦下并说清原因。
 */
const MAX_BATCH = MAX_SCAN_RESULTS
const MAX_DEPTH = 3

const scanSchema = z.object({
  dir: trimmed.min(1, '目录不能为空').max(400),
  /** 往里扫几层，默认只扫直接子目录 */
  depth: z.number().int().min(1).max(MAX_DEPTH).optional(),
  /** 顺便把这个目录记进「常用扫描目录」 */
  remember: z.boolean().optional(),
})

const importSchema = z.object({
  paths: z.array(trimmed.min(1)).min(1).max(MAX_BATCH),
  category: trimmed.max(60).optional(),
})



/**
 * 扫描与导入。
 *
 * 扫描只读：不写库、不动仓库。入库也是一条条 insert，
 * 这里永远不批量修改磁盘上的东西。
 */
export const scanRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  fastify.post('/scan', async (req) => {
    const { dir, depth, remember } = scanSchema.parse(req.body ?? {})
    const abs = toAbsolutePath(dir)
    if (!dirExists(abs)) throw badRequest(`目录不存在：${abs}`)

    if (remember) rememberScanDir(db, abs)

    const tracked = trackedProjects(db)
    // 走 lib/git.ts 的 scan()：它会把 server 的 scheduler 与设置里的超时一起传下去，
    // 免得扫描绕开并发上限。上限**显式**传（不用 core 的缺省值），
    // 这样「扫描列出的数量」与「导入能吃的数量」是同一个常量，改一处两边同时变。
    const result = await scan(abs, {
      maxDepth: depth ?? 1,
      maxResults: MAX_SCAN_RESULTS,
      trackedPaths: tracked.keys(),
    })

    return {
      dir: result.dir,
      // 上限信息一起报出去：界面要说清「只列了前 N 个」（悄悄截断等于说假话）
      candidates: result.candidates,
      truncated: result.truncated,
      found: result.found
        // 按路径排，保证两次扫描的顺序一致，方便用户比对
        .sort((a, b) => a.dir.localeCompare(b.dir))
        .map((repo) => {
          const hit = tracked.get(repo.dir.toLowerCase())
          return {
            ...repo,
            projectId: hit?.id ?? null,
            projectName: hit?.name ?? null,
            projectCategory: hit?.category ?? null,
          }
        }),
    }
  })

  fastify.post('/projects/import', async (req) => {
    const { paths, category } = importSchema.parse(req.body ?? {})
    const cat = category ?? ''
    const created: { id: number; name: string; path: string }[] = []
    const skipped: { path: string; reason: string }[] = []

    // 先把「哪些能进、各自的远程地址是什么」算完（这一步要 await）。
    // 读远程地址失败只降级成 null —— git 起不来 / 目录不是仓库都属可降级，
    // 不该把整批导入变成 500。
    const candidates: { name: string; path: string; remoteUrl: string | null }[] = []
    /*
      **批内也要查重**。原来只查「库里有没有」，于是同一批里出现两条指向同一目录的
      路径（大小写变体、8.3 短名、目录链接）时，两条都通过检查，最后撞上库层那条
      `lower(path)` 部分唯一索引 → 整批事务回滚 → 返回一句误导的 409
      「这条记录已经存在了」，而用户可能一个都还没加进去。
      比较口径与那条唯一索引一致（lower + 归一化斜杠）。
    */
    const seen = new Set<string>()
    for (const raw of paths) {
      const abs = toAbsolutePath(raw)
      const key = abs.toLowerCase()

      if (!dirExists(abs)) {
        skipped.push({ path: abs, reason: '目录不存在' })
        continue
      }
      if (seen.has(key)) {
        skipped.push({ path: abs, reason: '这一批里有重复的目录（大小写不同也算同一个）' })
        continue
      }
      if (pathExists(db, abs)) {
        skipped.push({ path: abs, reason: '已经在清单里了' })
        continue
      }
      seen.add(key)

      let remoteUrl: string | null = null
      try {
        remoteUrl = await getRemoteUrl(abs)
      } catch {
        remoteUrl = null
      }

      // 名字取目录名，远程地址从 git 读；记录留空，想写的时候到详情页写
      candidates.push({ name: path.basename(abs) || abs, path: abs, remoteUrl })
    }

    // 写入放进一个事务：中途任何一条失败都不留下部分结果，
    // 要么整批进、要么整批不进（原来的写法会留下写了一半的清单）。
    const insertAll = db.transaction(() => {
      for (const candidate of candidates) {
        const id = insertProject(db, {
          name: candidate.name,
          path: candidate.path,
          remoteUrl: candidate.remoteUrl,
          category: cat,
          record: '',
          sortOrder: nextSortOrder(db, cat),
        })
        created.push({ id, name: candidate.name, path: candidate.path })
      }
    })
    try {
      insertAll()
    } catch (err) {
      // 走到这里只剩「查过之后、插入之前别人也加了同一条」这一种竞态。
      // 全局错误处理器会给 409，但它的文案（「这条记录已经存在了」）用在这条路上
      // 看不出该做什么，所以这里换一句能指导动作的。
      if (isUniqueViolation(err)) {
        throw conflict('有目录刚被别的操作加进清单了，刷新后再看一次')
      }
      throw err
    }

    return { created, skipped }
  })
}

/** better-sqlite3 的 UNIQUE 约束错误（与 app.ts 的判定同一口径）。 */
function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: unknown; message?: unknown }
  if (candidate.code === 'SQLITE_CONSTRAINT_UNIQUE') return true
  return typeof candidate.message === 'string' && /UNIQUE constraint failed/i.test(candidate.message)
}

interface Tracked {
  id: number
  name: string
  path: string
  category: string
}

/** 清单里所有项目的路径（小写斜杠），扫描时用来标记 alreadyTracked。 */
function trackedProjects(db: DB): Map<string, Tracked> {
  const rows = db.prepare('SELECT id, name, path, category FROM projects').all() as Tracked[]
  return new Map(rows.map((r) => [r.path.toLowerCase(), r]))
}

function rememberScanDir(db: DB, dir: string): void {
  const { scanDirs } = readSettings(db)
  if (scanDirs.some((d) => d.toLowerCase() === dir.toLowerCase())) return
  writeSettings(db, { scanDirs: [...scanDirs, dir].slice(-50) })
}
