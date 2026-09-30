import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录（apps/server → ../../..） */
export const repoRoot = path.resolve(here, '..', '..', '..')

export const config = {
  port: Number(process.env['GIT_NEST_PORT'] ?? 5174),
  host: process.env['GIT_NEST_HOST'] ?? '127.0.0.1',
  dbFile: process.env['GIT_NEST_DB'] ?? path.join(repoRoot, 'data', 'git-nest.db'),
  /** 本地单用户工具，默认只监听回环地址 */
  corsOrigin: process.env['GIT_NEST_CORS'] ?? 'http://localhost:5173',
} as const
