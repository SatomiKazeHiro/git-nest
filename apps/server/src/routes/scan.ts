import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { DB } from '../db/index.ts'
import { badRequest } from '../lib/errors.ts'
import { getRemoteUrl, scan } from '../lib/git.ts'
import { dirExists, toAbsolutePath } from '../lib/paths.ts'
import { insertProject, nextSortOrder, pathExists } from '../repos/projects.ts'
import { readSettings, writeSettings } from '../lib/settings.ts'

const trimmed = z.string().trim()

/** 一次最多扫 / 导入多少个，防止手滑把整块硬盘塞进清单 */
const MAX_BATCH = 200
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
    // 免得扫描绕开并发上限
    const result = await scan(abs, {
      maxDepth: depth ?? 1,
      trackedPaths: tracked.keys(),
    })

    return {
      dir: result.dir,
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
    for (const raw of paths) {
      const abs = toAbsolutePath(raw)

      if (!dirExists(abs)) {
        skipped.push({ path: abs, reason: '目录不存在' })
        continue
      }
      if (pathExists(db, abs)) {
        skipped.push({ path: abs, reason: '已经在清单里了' })
        continue
      }

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
    insertAll()

    return { created, skipped }
  })
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
