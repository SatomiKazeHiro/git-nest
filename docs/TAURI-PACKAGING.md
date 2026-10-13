# Tauri 桌面包（备案）

目标：`src-tauri` 壳能起、dev 下打开窗口显示真实应用、本机 API（Fastify + better-sqlite3）以
**sidecar** 形式随包分发，最终产出可安装的构建产物；**过程中不破坏现有的 web/server 开发流程与全部测试**。

这份文档记的是**已经核实的事实**与**待定的决策**，不是待办清单。核实日期：2026-10-12。

## 一、今天的事实（都指到了文件与行）

| | 事实 |
|---|---|
| 前端 | `apps/web`，Vite 7，dev 在 **36378**（`strictPort: true`），`/api` 代理到 `GIT_NEST_API`（默认 `http://127.0.0.1:36379`）；已能 `pnpm -C apps/web build` 产出 `apps/web/dist` |
| 服务端 | `apps/server`，Fastify 5 + `better-sqlite3@^12.4.1`（**原生模块**）+ 调 `git` 子进程；`"type": "module"` |
| **服务端没有可分发构建** ✗ | `apps/server/package.json` 的 scripts 只有 `dev: tsx watch src/index.ts` / `start: tsx src/index.ts`，**没有 `build`**；`apps/server/dist` 不存在。`tsx` 是 devDependency。这是 sidecar 要先补的第一块 |
| 依赖里有 workspace 包 | `@git-nest/core: workspace:*`（端口常量、类型、`@git-nest/core/git` 子路径都在它里面）→ 打进包时**必须把它内联**，否则运行时解析不到那个软链 |
| **数据库路径有现成接缝** ✓ | `apps/server/src/config.ts:12` —— `dbFile: process.env['GIT_NEST_DB'] ?? path.join(repoRoot, 'data', 'git-nest.db')`。**打包后必须用这个环境变量指到应用数据目录**，因为 `repoRoot` 是从 `import.meta.url` 推出来的（`:5`），**打包/bundle 之后那个位置会变** ✗ |
| **CORS 有现成接缝** ✓ | `apps/server/src/config.ts:14` —— `corsOrigin: process.env['GIT_NEST_CORS'] ?? 'http://localhost:36378'`。**打包后 webview 的 origin 不是它** ✗（Tauri 2 在 Windows 上是 `http://tauri.localhost` 一类，dev 时才是 `localhost:36378`）→ 不覆盖它，应用里**每个写操作都会 403** ✗ |
| 端口只有一个来源 ✓ | `packages/core/src/types.ts` 的 `DEFAULT_PORTS`（web 36378 / api 36379）；`config.ts:10` 读 `GIT_NEST_PORT`，Vite 那边读 `GIT_NEST_API`。**Rust 侧与配置里都不许再抄一遍数字** ✗ |
| 监听 | `apps/server/src/index.ts:8` `app.listen({ port: config.port, host: config.host })`，没有"我起来了"的显式信号（Fastify 自己会打日志） |
| 工具链 | 本机 `cargo`/`rustc` **1.96.1**、node 22.22.3、pnpm 12.3.4 ✓ —— 能编译 |

## 二、待定的决策（每条都写明我的倾向与代价）

**D1 服务怎么随包分发** —— 选 **A：Node sidecar**（每个平台带一份 Node 运行时 + 一个服务端产物）。
B（服务留在壳外，壳只指过去）省事但**不算一个应用** ✗；C（用 Rust 重写服务）不做 ✗✗。

**D2 服务端用什么打** —— 倾向 **esbuild 单文件**：
`esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.mjs --external:better-sqlite3`。
理由：一条命令把 `@git-nest/core`（含子路径）**内联进来**，运行时不再依赖 workspace 软链 ✓。
代价/注意：`esbuild` 不是 `apps/server` 的现有依赖 ✗ → 要作为 **devDependency** 加进去（这是真实的
依赖新增，说明在此）；`better-sqlite3` **必须保持 external** ✓（原生 `.node` 不能打进 JS）；
加完要**实测** `node dist/index.mjs` 真能起、能响应一个只读请求。

**D3 原生模块怎么办** —— `better-sqlite3` 的 `.node` 按目标平台准备（dev 机上是现成的；
打包时把它连同 `node_modules/better-sqlite3` 一起拷进 sidecar 资源目录，或走它的 prebuild）。
**第一段只求本机能跑** ✓，跨平台留到出安装包那一轮再谈。

**D4 数据库放哪** —— 打包形态下用 **`GIT_NEST_DB`** 指到**应用数据目录**（Tauri 的 `app_data_dir` ✓），
不写进仓库的 `data/` ✗，也不写进只读的安装目录 ✗。dev 形态沿用现状（仓库 `data/` ✓）。
**待用户定**：装完之后是否要"导入现有 `data/git-nest.db`"的入口 ✗ —— 我倾向先不做，第一次启动就是空清单 ✓。

**D5 CORS** —— 壳起 sidecar 时把 `GIT_NEST_CORS` 设成**打包形态下 webview 的真实 origin**
（dev：`http://localhost:36378` ✓；打包：以实测为准 —— Tauri 2 在 Windows 上通常是
`http://tauri.localhost`）。**这条要在第一次真机跑时读出真实 origin 再钉死** ✓，别猜 ✗。

**D6 就绪握手** —— 壳先轮询 `127.0.0.1:<api port>`，起来了再让 webview 指过去（或先显示一句话）。
现在服务端没有显式的"我好了"信号 ✗；**先不改服务端** ✓，用轮询就够。

**D7 dev 形态** —— `tauri dev` 时前端仍走 Vite（36378，HMR 保留 ✓），服务端仍可用 `pnpm dev:server`
（Rust 壳不负责 dev 下的服务端 ✓）；只有**打包形态**才由壳起 sidecar ✓。这样两边的开发手感都不变 ✓。

## 三、第一段的可验收标准（只求"能编译、能起"）

1. `src-tauri/` 是 **Tauri 2** 的形态：`@tauri-apps/cli` 2.x、`tauri`/`tauri-build = "2"`、
   `tauri.conf.json` 用 **v2 schema**（`build`/`app`/`bundle`），权限走 **`capabilities/*.json`**，
   **不许出现 v1 的 `allowlist`** ✗；
2. `cargo check`（或 `tauri build --no-bundle`）**必须过** ✓；**先不追安装包** ✗（第一次 Rust 编译
   十几分钟起，且会拉平台工具链）；
3. `tauri dev` 能打开窗口并显示真实应用 —— **GUI 代理看不到** ✗，所以这一步交付的是**一条确切的
   命令**（以及该看到什么），由用户跑；
4. sidecar：要么做出**最小可信证明**（服务端构建产物 + `externalBin` + capability 权限都配好、
   壳能起它），要么**逐条列清差距** ✓ —— 宁可少做，**不许留半成品** ✗。

## 四、明确不做（这一轮）

- 安装包 / 签名 / 自动更新 ✗（等第一段跑通再谈）；
- 把服务端改写成 Rust ✗✗；
- 动 `apps/web` 的运行时依赖 ✗；动现有 `pnpm dev` / `test` / `typecheck` / `build` 的语义 ✗。
