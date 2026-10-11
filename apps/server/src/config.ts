import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录（apps/server → ../../..） */
 const repoRoot = path.resolve(here, '..', '..', '..')

export const config = {
  port: Number(process.env['GIT_NEST_PORT'] ?? 36379),
  host: process.env['GIT_NEST_HOST'] ?? '127.0.0.1',
  dbFile: process.env['GIT_NEST_DB'] ?? path.join(repoRoot, 'data', 'git-nest.db'),
  /** 本地单用户工具，默认只监听回环地址 */
  corsOrigin: process.env['GIT_NEST_CORS'] ?? 'http://localhost:36378',
  /**
   * 打包成桌面软件之后 webview 的来源。
   *
   * **这一条是「别等到打包那天才发现」的**：开发时页面跑在 vite 上，Origin 是
   * `http://localhost:36378`；装成应用之后 webview 自己起一个来源，那些写接口
   * 会因为不在白名单里而**全部 403**——添加项目、勾选更新、设置，一个都发不出去。
   * 而它只在打包后才现形，本地开发一路绿灯。
   *
   * 三种都留着，因为具体是哪个取决于 Tauri 版本与平台：
   * macOS / Linux 是 `tauri://localhost`，Windows v2 是 `http://tauri.localhost`，
   * Windows v1 是 `https://tauri.localhost`。多放几个的代价很小——这些 scheme
   * 浏览器里的普通网页拿不到，Origin 又不能伪造（值由浏览器按页面自己的来源
   * 填，脚本写不了），所以等于只认「我们自己那个窗口」。
   *
   * 留 `GIT_NEST_TAURI_ORIGIN`（逗号分隔）是为了将来换壳或者自建 scheme 时
   * 不用改代码；配成空字符串可以整个关掉。
   */
  tauriOrigins: (
    process.env['GIT_NEST_TAURI_ORIGIN'] ??
    'tauri://localhost,http://tauri.localhost,https://tauri.localhost'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const
