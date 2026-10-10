import type { DB } from '../db/index.ts'

/**
 * logo 结论的存取。**不存图片**——存的是「选中了仓库里哪个文件」这条判断，
 * 以及得出它时 README 的指纹（见 `lib/logo-scan.ts`）。
 *
 * 为什么不存图片字节：这个项目的不变量是「能从仓库自己读出来的不存」。
 * 存了还会出现两份真值（库里那张 vs 仓库里那张），换了 logo 之后界面上还是旧的，
 * 于是又得再造一套「什么时候该刷新」的机制——而路径这一份天然不会过期到看不出来：
 * 文件没了就什么都不显示。
 */

export interface LogoRow {
  /** 相对仓库根的路径（`/` 分隔）；null = 识别过，但这个项目没有 logo */
  path: string | null
  /** 得出这个结论时的 README 指纹 */
  stamp: string
}

export function getLogo(db: DB, projectId: number): LogoRow | null {
  const row = db
    .prepare('SELECT path, stamp FROM project_logos WHERE project_id = ?')
    .get(projectId) as LogoRow | undefined
  return row ?? null
}

export function saveLogo(
  db: DB,
  projectId: number,
  path: string | null,
  stamp: string,
): void {
  db.prepare(
    `INSERT INTO project_logos (project_id, path, stamp, picked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       path = excluded.path, stamp = excluded.stamp, picked_at = excluded.picked_at`,
  ).run(projectId, path, stamp, new Date().toISOString())
}

/**
 * 哪些项目有 logo（project_id → 相对路径）。
 *
 * 列表页要的是「这一行有没有」这一个布尔——**不能靠每行发一个 `<img>` 去试**：
 * 没有 logo 的项目会返回 404，十几个 404 在控制台里红成一片，而它们的共同点
 * 恰恰是「这个功能对它们不适用」。
 */
export function logoPaths(db: DB): Map<number, string> {
  const rows = db
    .prepare('SELECT project_id, path FROM project_logos WHERE path IS NOT NULL')
    .all() as { project_id: number; path: string }[]
  return new Map(rows.map((r) => [r.project_id, r.path]))
}
