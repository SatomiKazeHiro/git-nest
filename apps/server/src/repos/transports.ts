import type { RemoteTransport } from '@git-nest/core/git'
import type { DB } from '../db/index.ts'

/**
 * 「这个项目上次走通了哪条传输方式」——读取与落库。
 *
 * 为什么要有这张表：某个项目的 origin 是 HTTPS，`git fetch` 报连接被重置 /
 * 443 连不上，而**同一分钟**别的 SSH 项目 fetch 成功。core 的 `fetchWithFallback`
 * 会为那**一次**自动换路，但换路是有代价的（先把失败的那条路再走一遍，
 * 而它可能正好是 21 秒的连接超时）。记住走通的那条，下一次它就**先试**这条。
 *
 * 边界（与 core 的分工）：core 碰不到数据库，所以它只**返回**
 * `{ transport }`；「记住」这件事只发生在这里，由 `lib/git.ts` 一处落库——
 * 手动检查与 30 分钟自动 fetch 都经过那里，不必两处各写一遍。
 *
 * 这是**结论表**，不是事实来源：事实（origin 地址）永远从仓库自己读
 * （`readRemoteUrl`）。所以用户换了 remote 之后不需要任何清理——
 * core 会发现记住的那条路与当前地址对不上，直接退回规范顺序。
 */

const VALID: readonly string[] = ['https', 'ssh']

/**
 * 上次走通的传输方式；没有记录、记录坏了都返回 null
 * （null 的含义就是「还不知道」，此时 core 按地址本身的形式先试）。
 */
export function preferredTransport(db: DB, projectId: number): RemoteTransport | null {
  const row = db
    .prepare('SELECT transport FROM project_transports WHERE project_id = ?')
    .get(projectId) as { transport: string } | undefined
  const value = row?.transport
  return value && VALID.includes(value) ? (value as RemoteTransport) : null
}

/**
 * 记下这次走通的那条路（同一项目只留一行，后来的覆盖先前的）。
 *
 * 只在**真的 fetch 成功**之后调用：写错的结论会让下一次先把错的那条路走一遍，
 * 那正是这张表要避免的成本。
 */
export function rememberTransport(
  db: DB,
  projectId: number,
  transport: RemoteTransport,
): void {
  if (!VALID.includes(transport)) return
  db.prepare(
    `INSERT INTO project_transports (project_id, transport, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET transport = excluded.transport, updated_at = excluded.updated_at`,
  ).run(projectId, transport, new Date().toISOString())
}

/** 忘掉这个项目的记录（测试与将来「重新探测」用）。 */
export function forgetTransport(db: DB, projectId: number): void {
  db.prepare('DELETE FROM project_transports WHERE project_id = ?').run(projectId)
}
