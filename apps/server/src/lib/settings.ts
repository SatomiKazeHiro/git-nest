import { z } from 'zod'
import type { DB } from '../db/index.ts'
import { clearStatusCache } from './git.ts'

const trimmed = z.string().trim()

/**
 * 设置项：超时 / 并发 / 扫描目录那几个参数。
 * 一张 key-value 表就够，不做正经的配置系统。
 */
export interface Settings {
  /** 我自己的项目（`projects.is_own`）默认不参与批量更新检测 */
  includeOwn: boolean
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
  includeOwn: false,
  gitTimeoutMs: 120_000,
  concurrency: 4,
  confirmThreshold: 20,
  scanDirs: [],
}

export const settingsSchema = z
  .object({
    includeOwn: z.boolean().optional(),
    gitTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    concurrency: z.number().int().min(1).max(16).optional(),
    confirmThreshold: z.number().int().min(1).max(200).optional(),
    scanDirs: z.array(trimmed.min(1).max(400)).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有要改的设置' })

/**
 * 数值设置的合法区间。**与 `settingsSchema` 的边界必须一致** ——
 * 这里是读取侧的兜底，写入口在路由层。
 */
const RANGES = {
  gitTimeoutMs: { min: 1_000, max: 600_000 },
  concurrency: { min: 1, max: 16 },
  confirmThreshold: { min: 1, max: 200 },
} as const

/** 把库里的数字夹到合法区间；非有限值退回默认值。 */
function clampNumber(key: keyof typeof RANGES, value: number, fallback: number): number {
  const { min, max } = RANGES[key]
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

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
      // 读取侧也夹一道：校验只在路由层，任何绕过路由的写入（直连 sqlite 改库、
      // 将来的迁移脚本）都能塞进 0 或负数，而 `gitTimeoutMs = 0` 会让**所有**
      // git 命令立刻超时。这里照 schema 的边界收口。
      bag[key] = clampNumber(key as keyof typeof RANGES, Number(raw), fallback as number)
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
