import type { DB } from '../db/index.ts'
import type { Tag } from '@git-nest/core'

export function listTags(db: DB): Tag[] {
  const rows = db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all() as {
    id: number
    name: string
    color: string | null
  }[]
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color }))
}

export function createTag(db: DB, input: { name: string; color: string | null }): Tag {
  const info = db
    .prepare('INSERT INTO tags (name, color) VALUES (@name, @color)')
    .run({ name: input.name, color: input.color })
  return { id: Number(info.lastInsertRowid), name: input.name, color: input.color }
}

export function tagIdByName(db: DB, name: string): number | null {
  const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined
  return row?.id ?? null
}

/** 整体替换某个项目的 tag 集合；不存在的标签名按需创建。 */
export function setProjectTags(db: DB, projectId: number, tagNames: string[]): void {
  const unique = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))]
  const findOrCreate = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insert = db.prepare('INSERT INTO tags (name, color) VALUES (?, NULL)')

  const tx = db.transaction(() => {
    const ids: number[] = []
    for (const name of unique) {
      const found = findOrCreate.get(name) as { id: number } | undefined
      ids.push(found ? found.id : Number(insert.run(name).lastInsertRowid))
    }
    db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId)
    const link = db.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)')
    for (const tagId of ids) link.run(projectId, tagId)
  })
  tx()
}

export function tagUsageCount(db: DB): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT t.name, COUNT(pt.project_id) AS n FROM tags t
       LEFT JOIN project_tags pt ON pt.tag_id = t.id GROUP BY t.id`,
    )
    .all() as { name: string; n: number }[]
  return new Map(rows.map((r) => [r.name, r.n]))
}

export function deleteTag(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0
}
