import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db/index.ts'
import { migrations } from '../src/db/migrations.ts'

/**
 * 迁移 004 **是破坏性的**：删掉 `projects.source_url` / `projects.summary` 两列
 * 和 `notes` 表，只留一个 `record`（见设计文档第 13 节第 19 条）。
 *
 * 其它测试都在空库上跑迁移，删列/删表「恰好没数据」也能过；而这个库是要在
 * 用户真实的数据库上跑的，所以这里专门造一个「004 之前」的库：跑 001–003、
 * 塞进真实行，再用 `openDatabase` 打开，确认不炸、该在的在、该没的没了。
 */
describe('迁移 004：老库升级', () => {
  const files: string[] = []

  afterEach(() => {
    for (const f of files.splice(0)) {
      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(`${f}${suffix}`, { force: true })
      }
    }
  })

  /** 造一个停在 004 之前、并且**有数据**的库 */
  function makePreRecordDatabase(): string {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-mig-')), 'old.db')
    files.push(file)

    const db = new Database(file)
    db.exec(`CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
    for (const m of migrations) {
      if (m.id === '004_project_record') break
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        m.id,
        new Date().toISOString(),
      )
    }
    db.prepare(
      `INSERT INTO projects (name, path, remote_url, category, source_url, summary, added_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '老项目',
      'D:/repos/old',
      'https://example.invalid/old.git',
      'tools',
      'https://example.invalid/video',
      '老摘要',
      '2026-10-01T00:00:00Z',
      10,
    )
    db.prepare(
      `INSERT INTO notes (project_id, content, created_at, updated_at) VALUES (1, ?, ?, ?)`,
    ).run('老备注', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')
    db.close()
    return file
  }

  it('升级后项目还在、身份信息没丢，并且多出一个空的 record', () => {
    const file = makePreRecordDatabase()
    const db = openDatabase(file)

    const row = db
      .prepare('SELECT name, path, remote_url, category, record FROM projects WHERE id = 1')
      .get() as { name: string; path: string; remote_url: string; category: string; record: string }
    expect(row).toEqual({
      name: '老项目',
      path: 'D:/repos/old',
      remote_url: 'https://example.invalid/old.git',
      category: 'tools',
      record: '', // 新列有默认值，不是 NULL —— 前端那个文本框直接绑定它
    })
    db.close()
  })

  it('老的两列与 notes 表真的没了（不是留着占地方）', () => {
    const file = makePreRecordDatabase()
    const db = openDatabase(file)

    const columns = (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(columns).toContain('record')
    expect(columns).not.toContain('source_url')
    expect(columns).not.toContain('summary')

    const notes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'`)
      .get()
    expect(notes).toBeUndefined()
    db.close()
  })

  it('重复打开是幂等的（迁移记录拦住了第二次执行）', () => {
    const file = makePreRecordDatabase()
    openDatabase(file).close()
    // 第二次打开：004 已在 schema_migrations 里，不该再执行一遍（否则会报重复列）
    expect(() => openDatabase(file).close()).not.toThrow()
  })
})
