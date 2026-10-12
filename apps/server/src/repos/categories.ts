import type { DB } from '../db/index.ts'
import {
  RESERVED_CATEGORY_LABELS,
  categoryLabelKey,
  normalizeCategoryLabel,
  type Category,
  type CategoryLabelProblem,
} from '@git-nest/core'

/**
 * 分类的读写。
 *
 * **「未分类」不是表里的一行**：它在 `projects.category` 里是空串，在界面上叫
 * 「未分类」。所以这张表没有指向 projects 的外键（空串指不到任何一行，加了约束
 * 那种项目就写不进去），存在性校验是应用层的事——见 `isAssignableCategory`。
 */

/** 未分类在库里的样子 */
const UNCATEGORIZED_KEY = ''

/** 从显示名生成 key：只留字母数字，其余折成连字符。 */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface CategoryRow {
  key: string
  label: string
  icon: string | null
  builtin: number
  projectCount: number
}

const toCategory = (r: CategoryRow): Category => ({
  key: r.key,
  label: r.label,
  icon: r.icon,
  builtin: r.builtin === 1,
  projectCount: r.projectCount,
})

/** 引用数在 SQL 里数完——设置页与左栏都要显示「N 个项目」。 */
const SELECT_CATEGORY = `
  SELECT c.key, c.label, c.icon, c.builtin,
         (SELECT COUNT(*) FROM projects p WHERE p.category = c.key) AS projectCount
  FROM categories c`

/** 按 sort_order 排：内置四个 0–3，用户加的一律排在后面。 */
export function listCategories(db: DB): Category[] {
  const rows = db
    .prepare(`${SELECT_CATEGORY} ORDER BY c.sort_order, c.key`)
    .all() as CategoryRow[]
  return rows.map(toCategory)
}

export function categoryByKey(db: DB, key: string): Category | null {
  const row = db.prepare(`${SELECT_CATEGORY} WHERE c.key = ?`).get(key) as CategoryRow | undefined
  return row ? toCategory(row) : null
}

/**
 * 显示名能不能用。**一条规则，两个来源**（而不是给每种情况写一个特例）：
 *
 * 1. **保留字**（`RESERVED_CATEGORY_LABELS`）：「未分类」是「没有分类」的哨兵，
 *    再拿它当分类名，左栏就会出现两行同名却在做不同的事；
 * 2. **与任何已存在的分类重名**——内置四个也在 `categories` 表里，所以「工具」
 *    这种名字被这一条自然挡住，不需要再单独列举一遍内置项。
 *
 * 比较走 `categoryLabelKey`（归一化 + 忽略大小写）：写入时已经归一过一遍
 * （见 `createCategory`），这里再算一次是为了让「库里已有的旧行」与「这次要写的
 * 新值」用同一把尺子。
 *
 * `exceptKey` 是给改名用的：把分类改成它**当前**的名字（或只改大小写、只加空格）
 * 必须放行，否则「只改一下图标」这类操作会被它自己的名字挡住。
 *
 * 返回 null = 可以用；**措辞不在这里**——它和规则一起住在 core（`labelProblemMessage`）。
 */
export function categoryLabelProblem(
  db: DB,
  label: string,
  exceptKey?: string,
): CategoryLabelProblem | null {
  const wanted = categoryLabelKey(label)

  for (const reserved of RESERVED_CATEGORY_LABELS) {
    if (categoryLabelKey(reserved) === wanted) return { kind: 'reserved', label: reserved }
  }

  const rows = db.prepare('SELECT key, label FROM categories').all() as {
    key: string
    label: string
  }[]
  const hit = rows.find((r) => r.key !== exceptKey && categoryLabelKey(r.label) === wanted)
  return hit ? { kind: 'duplicate', label: hit.label } : null
}

/**
 * 新增。**key 由服务端生成**（调用方只给名字）：
 *
 * - 从名字取 slug（`AI 项目` → `ai`）；
 * - 撞了就加序号（`ai` → `ai-2`）；
 * - 名字全是中文时 slug 是空的——那不是错误，是常态，兜底成 `cat-1`、`cat-2`…
 *   （兜底的第一个**带 `-1`**：直接用 `cat` 的话，第二个中文分类会撞上它，
 *   于是两条路生成出来的 key 长得很不一样）。
 */
export function createCategory(db: DB, input: { label: string; icon: string | null }): Category {
  // **存归一后的名字**：内部连续空白压成一个、两头去掉。不这么做的话
  // 「AI  项目」与「AI 项目」会成为两条长得几乎一样、却永远分在两处的记录。
  const label = normalizeCategoryLabel(input.label)
  const slug = slugify(label)
  const base = slug || 'cat'
  let key = slug || `${base}-1`
  let n = 1
  while (categoryByKey(db, key)) key = `${base}-${++n}`

  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories')
    .get() as { n: number }
  db.prepare(
    'INSERT INTO categories (key, label, icon, builtin, sort_order) VALUES (?, ?, ?, 0, ?)',
  ).run(key, label, input.icon, next.n)

  const created = categoryByKey(db, key)
  if (!created) throw new Error('分类写入后读不回来')
  return created
}

/** 改名 / 改图标。**key 不改**——每个项目的 `category` 里存的就是它。 */
export function updateCategory(
  db: DB,
  key: string,
  patch: { label?: string; icon?: string | null },
): boolean {
  const sets: string[] = []
  const params: (string | null)[] = []
  if (patch.label !== undefined) {
    sets.push('label = ?')
    // 改名同样存归一后的值：否则「只多敲了一个空格」的重命名会把库里那一条改型
    params.push(normalizeCategoryLabel(patch.label))
  }
  if (patch.icon !== undefined) {
    sets.push('icon = ?')
    params.push(patch.icon)
  }
  // 调用方（路由）已经用 schema 挡过空 patch，这里是兜底
  if (sets.length === 0) return false
  return (
    db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE key = ?`).run(...params, key).changes >
    0
  )
}

/**
 * 删掉一个分类，并把引用它的项目**退回未分类**。
 *
 * 两件事必须在同一个事务里：先删行再改项目的话，中间那一瞬项目指向一个不存在的
 * 分类；反过来先改项目再删行更糟——删行失败就把用户的分类归属悄悄抹了，而那条
 * 记录还在。
 *
 * 返回的 `moved` 就是界面确认框里那个「N 个项目」：删之前得先问出来，
 * 才能让人知道自己在同意什么。
 */
export function deleteCategory(db: DB, key: string): { removed: number; moved: number } {
  const tx = db.transaction(() => {
    const moved = db
      .prepare('UPDATE projects SET category = ? WHERE category = ?')
      .run(UNCATEGORIZED_KEY, key).changes
    const removed = db.prepare('DELETE FROM categories WHERE key = ?').run(key).changes
    return { removed, moved }
  })
  return tx()
}

/**
 * 项目上的分类合不合法：**空串永远合法**（扫描导入的一律留空，那是最常见的取值），
 * 其余必须真的在表里。
 *
 * 原来这是编译期的枚举（`z.enum(...)`），分类变成「用户可以自己加的表里的一行」
 * 之后，枚举不可能覆盖全部取值，只能改成「问一次库」。
 */
export function isAssignableCategory(db: DB, key: string): boolean {
  if (key === UNCATEGORIZED_KEY) return true
  return db.prepare('SELECT 1 FROM categories WHERE key = ?').get(key) !== undefined
}
