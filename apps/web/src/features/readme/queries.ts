import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

/**
 * wire 上的形状，**照抄服务端返回的四个字段**。
 *
 * 故意不从 `@git-nest/core/git` 引 `ReadmeResult`：那个入口带 node:child_process，
 * 浏览器侧一碰就炸（core/index.ts 顶部那段注释就是在说这件事）。
 */
export interface ReadmeData {
  /** 命中的文件名；没有可读的就 null。**不是路径**——路径不出本机。 */
  file: string | null
  content: string | null
  /** 真被截断了吗（「上限内的完整」不是截断） */
  truncated: boolean
  /** 文件真实大小（字节）——按钮上要如实显示 */
  bytes: number
}

/**
 * `full` 进 query key，所以「加载完整文档」就是换一条查询：
 * 首屏那条不动，完整那条单独缓存，切回概览再回来也不用重新读盘。
 */
export function useReadme(projectId: number, full: boolean) {
  return useQuery({
    queryKey: queryKeys.readme(projectId, full),
    queryFn: () => api.get<ReadmeData>(`/projects/${projectId}/readme${full ? '?full=1' : ''}`),
  })
}