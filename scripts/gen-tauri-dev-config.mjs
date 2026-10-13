#!/usr/bin/env node
/**
 * 生成 `src-tauri/gen/app.config.json`——给 Tauri CLI 用 `--config` 加载的那份覆盖配置。
 *
 * ## 为什么需要它
 *
 * `build.devUrl`（dev 形态下窗口该打开哪个地址）里的端口必须和
 * `packages/core/src/types.ts` 的 `DEFAULT_PORTS.web` 一致。Tauri 的配置是静态
 * JSON、没有插值能力，所以在 `tauri.conf.json` 里再写一遍 `36378` 就是在制造
 * core 那段注释点名要消灭的「悄悄不一致」：改了 core 忘了改它，窗口打开的是
 * **别的**服务（或者白屏），而报错不会告诉你是端口没跟上。
 *
 * 于是默认配置里刻意**不写** `devUrl`，由这个脚本从 core 读出来生成。
 *
 * ## 和 `src-tauri/build.rs` 的分工
 *
 * 两边都能生成这个文件，而且都从同一个源读端口：
 *
 * - `build.rs`：`cargo check` / `cargo build` 直接跑时也需要它（不经过 pnpm 脚本）
 * - 这个脚本：`pnpm desktop:dev` / `desktop:build` 用，**在 CLI 启动前**跑，
 *   因为 CLI 是先读配置再决定要不要编译的——等 build.rs 跑就太晚了
 *
 * 两份实现读同一个源、写同一个文件，所以不会飘；内容相同则**不重写文件**，
 * 免得 Tauri 的 dev watcher 因为 mtime 变化反复重启应用。
 *
 * 用法：node scripts/gen-tauri-dev-config.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreTypes = path.join(repoRoot, 'packages', 'core', 'src', 'types.ts')
const target = path.join(repoRoot, 'src-tauri', 'gen', 'app.config.json')

/** 从 core 的 `DEFAULT_PORTS` 里取 web 端口。取不到就**报错退出**，不猜。 */
function webPort() {
  const source = readFileSync(coreTypes, 'utf8')
  const at = source.indexOf('DEFAULT_PORTS')
  if (at < 0) throw new Error(`${coreTypes} 里找不到 DEFAULT_PORTS`)
  const body = source.slice(at, source.indexOf('}', at))
  const match = /web\s*:\s*(\d+)/.exec(body)
  if (!match) throw new Error(`DEFAULT_PORTS 里找不到 web 端口：${body}`)
  return Number(match[1])
}

const port = webPort()
const contents = `${JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }, null, 2)}\n`

mkdirSync(path.dirname(target), { recursive: true })
// 存在性要先判：文件还没生成过时直接 readFileSync 会抛 ENOENT 而不是走「需要写入」
if (existsSync(target) && readFileSync(target, 'utf8').trim() === contents.trim()) {
  console.log(`src-tauri/gen/app.config.json 已是最新（devUrl = http://localhost:${port}）`)
} else {
  writeFileSync(target, contents)
  console.log(`写入 src-tauri/gen/app.config.json（devUrl = http://localhost:${port}）`)
}
