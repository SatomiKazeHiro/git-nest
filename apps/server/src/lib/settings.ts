import { z } from 'zod'
import type { DB } from '../db/index.ts'
import { clearStatusCache } from './git.ts'

const trimmed = z.string().trim()

/**
 * 设置项。设计文档第 7.3 节列的那几个参数。
 * 一张 key-value 表就够，不做正经的配置系统。
 */
export interface Settings {
  /** personal 分类默认不参与批量更新检测 */
  includePersonal: boolean
  /** 单条 git 命令超时（毫秒） */
  gitTimeoutMs: number
  /** 跨仓库并发上限 */
  concurrency: number
  /** 批量操作超过这个数量先让用户确认范围 */
  confirmThreshold: number
  /** 常用扫描目录，扫完不用再输路径 */
  scanDirs: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  includePersonal: false,
  gitTimeoutMs: 120_000,
  concurrency: 4,
  confirmThreshold: 20,
  scanDirs: [],
}

export const settingsSchema = z
  .object({
    includePersonal: z.boolean().optional(),
    gitTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    concurrency: z.number().int().min(1).max(16).optional(),
    confirmThreshold: z.number().int().min(1).max(200).optional(),
    scanDirs: z.array(trimmed.min(1).max(400)).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有要改的设置' })

export function readSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = new Map(rows.map((r) => [r.key, r.value]))
  const out: Settings = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const raw = stored.get(key)
    if (raw === undefined) continue
    const fallback = DEFAULT_SETTINGS[key]
    const bag = out as unknown as Record<string, unknown>
    if (typeof fallback === 'boolean') {
      bag[key] = raw === 'true'
    } else if (Array.isArray(fallback)) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) bag[key] = parsed.filter((v) => typeof v === 'string')
      } catch {
        // 存坏了就当没配过
      }
    } else {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) bag[key] = parsed
    }
  }
  return out
}

export function writeSettings(db: DB, patch: Partial<Settings>): Settings {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      stmt.run(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
    }
  })()
  // 超时/并发变了，之前缓存的状态可能不对
  clearStatusCache()
  return readSettings(db)
}
