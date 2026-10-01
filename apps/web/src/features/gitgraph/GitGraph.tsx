import { useQuery } from '@tanstack/react-query'
import { GitLog, type GitLogEntry as LibGitLogEntry } from '@tomplum/react-git-log'
import type { GitLogEntry } from '@git-nest/core'
import { api } from '@/lib/api'

/**
 * 提交图。
 *
 * 用 `@tomplum/react-git-log` —— 设计文档第 4 节原本指定的就是这个库
 * （「可插拔弱依赖，不可用则自研替换」）。我们自研过一版泳道图，但它的列分配
 * 有车道泄漏：真实仓库 archify（120 提交、19 个 merge）算出 40 条列、其中 8 条
 * 没人引用，再被宽度上限一夹，75/120 个提交点被画到画布外。这个缺陷整类来自
 * 「自己写图布局」，用库就不存在了。
 *
 * 这一层只做两件事：取数 + 把服务器字段映射成库要的形状。
 * 接口仍然只在这一个文件里，将来要换库/换渲染方式只动这里。
 */

export interface RepoLog {
  entries: GitLogEntry[]
  /** 当前检出的分支名（detached 时是 HEAD） */
  branch: string
}

export function useRepoLog(projectId: number | null, max = 120) {
  return useQuery({
    queryKey: ['log', projectId, max],
    queryFn: () =>
      api.get<RepoLog>(`/projects/${projectId}/log?max=${max}`),
    enabled: projectId !== null,
    staleTime: 10_000,
  })
}

/** 服务器的 GitLogEntry → 库的 GitLogEntry。字段一一对应，只差命名。 */
function toLibraryEntry(entry: GitLogEntry, branch: string): LibGitLogEntry {
  return {
    hash: entry.hash,
    branch,
    parents: entry.parents,
    message: entry.subject,
    author: { name: entry.authorName, email: entry.authorEmail },
    committerDate: entry.committerDate,
    authorDate: entry.authorDate,
  }
}

export function GitGraph({ projectId }: { projectId: number | null }) {
  const { data, isPending, error } = useRepoLog(projectId)

  if (error) {
    return (
      <p className="py-6 text-[13px] text-ink-2">
        {error instanceof Error && error.message ? error.message : '读不到提交记录'}
      </p>
    )
  }
  if (isPending) {
    return <p className="py-6 font-mono text-[13px] text-ink-3">正在读提交记录…</p>
  }
  if (!data || data.entries.length === 0) {
    return <p className="py-6 text-[13px] text-ink-3">这个仓库还没有提交。</p>
  }

  const branch = data.branch || 'HEAD'
  const entries = data.entries.map((e) => toLibraryEntry(e, branch))

  return (
    <div className="overflow-x-auto">
      <GitLog entries={entries} currentBranch={branch} showHeaders defaultGraphWidth={220}>
        <GitLog.Tags />
        <GitLog.GraphHTMLGrid nodeTheme="plain" showCommitNodeTooltips />
        <GitLog.Table timestampFormat="YYYY-MM-DD HH:mm" />
      </GitLog>
    </div>
  )
}
