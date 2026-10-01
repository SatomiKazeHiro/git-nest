import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/settings.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

/**
 * 设置读取侧的兜底。
 *
 * 校验只在路由层（`settingsSchema`），而 `readSettings` 原来对库里的数字
 * **照单全收**：任何绕过路由的写入（直连 sqlite 改库、将来的迁移脚本）都能塞进
 * 0 或负数，而 `gitTimeoutMs = 0` 会让**所有** git 命令立刻超时。
 * 现在读取侧照 schema 的边界夹一道。
 */

let db: DB

beforeEach(() => {
  db = openDatabase(':memory:')
})

function set(key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

describe('readSettings 的数值夹取', () => {
  it('gitTimeoutMs = 0 会被夹到下限（否则所有 git 立刻超时）', () => {
    set('gitTimeoutMs', '0')
    expect(readSettings(db).gitTimeoutMs).toBe(1_000)
  })

  it('负数同理', () => {
    set('gitTimeoutMs', '-5000')
    expect(readSettings(db).gitTimeoutMs).toBe(1_000)
  })

  it('超大值夹到上限', () => {
    set('gitTimeoutMs', '999999999')
    expect(readSettings(db).gitTimeoutMs).toBe(600_000)
  })

  it('concurrency 被夹到 1–16', () => {
    set('concurrency', '0')
    expect(readSettings(db).concurrency).toBe(1)
    set('concurrency', '999')
    expect(readSettings(db).concurrency).toBe(16)
  })

  it('confirmThreshold 被夹到 1–200', () => {
    set('confirmThreshold', '0')
    expect(readSettings(db).confirmThreshold).toBe(1)
    set('confirmThreshold', '5000')
    expect(readSettings(db).confirmThreshold).toBe(200)
  })

  it('存了非数字就退回默认值', () => {
    set('gitTimeoutMs', '不是数字')
    expect(readSettings(db).gitTimeoutMs).toBe(DEFAULT_SETTINGS.gitTimeoutMs)
  })

  it('合法值原样保留', () => {
    set('gitTimeoutMs', '30000')
    set('concurrency', '8')
    const s = readSettings(db)
    expect(s.gitTimeoutMs).toBe(30_000)
    expect(s.concurrency).toBe(8)
  })
})
