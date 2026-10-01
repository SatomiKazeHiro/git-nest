import type { DB } from '../db/index.ts'
import type { Note } from '@git-nest/core'

/**
 * 备注的读写。
 *
 * 以前读在 `repos/projects.ts`、写却散在 `routes/index.ts` 里直接拼 SQL ——
 * 同一张表两个入口，加约束时很容易只改一处。统一收到这里。
 */

function toNote(r: {
  id: number
  project_id: number
  content: string
  created_at: string
  updated_at: string
}): Note {
  return {
    id: r.id,
    projectId: r.project_id,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listNotes(db: DB, projectId: number): Note[] {
  const rows = db
    .prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY created_at DESC, id DESC')
    .all(projectId) as Parameters<typeof toNote>[0][]
  return rows.map(toNote)
}

export function createNote(db: DB, projectId: number, content: string): number {
  const now = new Date().toISOString()
  const info = db
    .prepare('INSERT INTO notes (project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(projectId, content, now, now)
  return Number(info.lastInsertRowid)
}

/** 返回是否真的改到了行（用于 404） */
export function updateNote(db: DB, noteId: number, content: string): boolean {
  const info = db
    .prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, new Date().toISOString(), noteId)
  return info.changes > 0
}

/** 返回是否真的删到了行（用于 404） */
export function deleteNote(db: DB, noteId: number): boolean {
  return db.prepare('DELETE FROM notes WHERE id = ?').run(noteId).changes > 0
}

export function countNotes(db: DB, projectId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE project_id = ?').get(projectId) as {
    n: number
  }
  return row.n
}
