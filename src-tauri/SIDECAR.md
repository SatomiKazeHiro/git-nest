# sidecar：Node 服务随包分发（第一段进度与差距）

选的是 **A：把 Node 当 sidecar 打进包**。

- **B**（服务留在壳外，壳只指 `http://127.0.0.1:36379`）：最省事，但用户得自己先起服务
  ——那不算一个应用，不选。
- **C**（用 Rust 重写服务）：不做。

## 已经做完并且**实测过**的部分

### 1. 服务端有了可分发产物

`apps/server` 原来只有 `tsx watch src/index.ts`（dev 专用：要 node_modules、要 tsx、
要能读 `.ts`）。现在 `pnpm desktop:sidecar`（= `scripts/build-sidecar.mjs`）产出：

```
src-tauri/binaries/
  git-nest-server-x86_64-pc-windows-msvc.exe   ← externalBin：一支 Node 运行时
  node-resources/git-nest-server/              ← bundle.resources
    index.mjs                                  ← esbuild 打包后的服务（2915 KB）
    run.cjs                                    ← sidecar 入口：import('./index.mjs')
    node_modules/better-sqlite3/               ← lib/ + build/Release/better_sqlite3.node
    node_modules/bindings/                     ← better-sqlite3 运行时的 loader
    node_modules/file-uri-to-path/             ← bindings 无条件 require 的那一个
    README.txt                                 ← 这份产物的自述（平台 / 版本 / 端口）
```

三件要说清的事：

- **哪一份是 Node、哪一份是脚本**：`git-nest-server-<triple>.exe` **就是 Node 运行时**
  （从 `process.execPath` 复制来的，本机 v22.22.3，约 80 MB）。它不是我们的服务，
  只是一支能跑 JS 的解释器。真正的服务是 `node-resources/git-nest-server/index.mjs`。
  壳执行的是 `exe 自己 + 脚本绝对路径`，等价于 `node <脚本>`。
- **为什么需要 `run.cjs`**：Tauri 的 `externalBin` 只能给一支可执行文件、没有
  「命令行参数」这一说，而 Node 要跑一个脚本必须把脚本路径当 argv 传进去。
  `run.cjs` 就是那个 argv，用 `import()` 把 `index.mjs` 拉起来（`index.mjs` 是 ESM，
  不能被 `require`）。它只有三行，不引任何依赖。
- **原生模块为什么打不进 bundle**：`better-sqlite3` 的 `lib/index.js` 最后是
  `require('bindings')('better_sqlite3.node')`——一个真的 `.node` 二进制。
  esbuild 只能把它标成 external，然后由 Node 在**运行时**从
  `index.mjs` 同级的 `node_modules/` 解析。所以这三包必须随包带齐。

### 2. 实测记录（隔离运行，有鉴别力）

`node scripts/smoke-sidecar.mjs` 把产物**整份复制到 `%TEMP%` 下一个空目录**再启动
（并清掉 `NODE_PATH`），这样最近的祖先里只有随包那份 `node_modules`——
**在仓库里就地跑是没有鉴别力的**：Node 的模块解析会沿目录树往上走，命中仓库根或
`apps/server` 的 `node_modules`，绿了也证明不了随包能起。

```
[smoke] 隔离目录 C:\Users\HONOR\AppData\Local\Temp\git-nest-isolated-LhBUjz
[smoke] 变体=bin 命令=git-nest-server-x86_64-pc-windows-msvc.exe
[smoke] 进程 exitCode=null
[smoke] /api/health => {"ok":true,"database":"ok"}
[smoke] 数据库文件已创建=true
```

`node index.mjs` 那条变体同样绿。**反向对照**也跑了：`--no-native` 抽掉随包的
`node_modules` 之后，同一条命令报
`Cannot find package 'better-sqlite3' imported from …\index.mjs` 并退出——
说明上面那次绿**真的是**靠随包那份，而不是靠临时目录外面的什么东西。

顺带验到的事实：`GIT_NEST_PORT` / `GIT_NEST_DB` 两个环境变量在产物里生效
（冒烟用的是临时库，`数据库文件已创建=true`），也就是「数据库路径可被壳指到应用数据目录」
这条接缝是通的。

### 3. 壳这一侧已经接好（但**没能**真机验证）

- `tauri.conf.json`：`bundle.externalBin: ["binaries/git-nest-server"]` +
  `bundle.resources: ["binaries/node-resources/git-nest-server/**/*"]`
- `tauri-plugin-shell = "2"`（v2 用插件，v1 的 allowlist 已不存在）
- `src/lib.rs` 的 `spawn_api_server()`：只 **release** 拉 sidecar（dev 下前端走 vite
  代理、服务由 `pnpm dev` 提供，壳再拉一个会 EADDRINUSE）；传 `GIT_NEST_PORT`
  （从 `packages/core` 生成）、`GIT_NEST_DB`（`app_data_dir()/git-nest.db`）、
  `GIT_NEST_CORS`（按平台的 webview 来源）；排空子进程 stdout/stderr；
  `RunEvent::ExitRequested` 时杀掉子进程。
- capability 里**没有**声明 shell 权限：拉起 sidecar 用的是 `tauri-plugin-shell` 的
  **Rust API**，不走前端 IPC，所以 ACL 管不到、也不需要开
  `shell:allow-execute`（最小权限）。将来若让前端自己 spawn，必须另加该权限。
- `cargo check` 必须**先**有 `binaries/git-nest-server-<triple>.exe`，否则 tauri-build
  直接报 `resource path ... doesn't exist`（实测）。所以 `desktop:check` /
  `desktop:dev` / `desktop:build` 都串了 `pnpm desktop:sidecar`。

## 还差什么（逐条，别把这部分当已完成）

1. **`tauri build --no-bundle` 没跑过**：本轮只跑到 `cargo check`。
   `resources` 的 glob 与 `externalBin` 的落点只在 `cargo check` 阶段被**校验了存在性**，
   真正的「复制到资源目录」要等一次完整 build。**这是最该先补的一步。**
2. **壳能不能真的把 sidecar 拉起来，没验过**：需要 GUI 与 release 构建。
   本轮起不了窗口，所以 `spawn_api_server()` 在 release 下的整条路径
   （`resource_dir()` 解析、`current_exe()` 旁边的 exe、`GIT_NEST_CORS`）都是**照文档写的**，
   没有真机跑过。
3. **前端还不知道 API 在哪** ✗ —— 这是当前**最大**的一个洞。
   `apps/web/src/lib/api.ts` 里是相对路径 `fetch('/api' + path)`，`taskStream.ts` 里是
   `new EventSource('/api/...')`。dev 形态下 vite 代理把 `/api` 转给 36379 ✓；**打包形态下
   没有 vite 代理**，`/api` 会打到 webview 自己的来源（`http://tauri.localhost`）上，
   **一个请求都到不了服务端** ✗。
   要补的是「让前端知道 API 的绝对地址」，两条候选（都还没做）：
   - 壳在启动时把地址注入页面（例如 `withGlobalTauri` 已经开了，可以从 Rust 侧
     通过 `webview.eval()` 写一个全局变量，前端读它、读不到再回退到相对路径）；
   - 或者构建期由 Vite 注入（`define`），但那个端口又要在 web 侧出现一次 ✗。

   这一步动的是 `apps/web` 的**源码**（不是依赖），并且要保住「浏览器里开发照旧能用
   相对路径 + vite 代理」。建议单独一轮做，带测试。
4. **Node 运行时的分发方式只是权宜**：现在是复制**构建机的** `node.exe`，所以产物与
   构建机同平台，也没有版本校验。出安装包那一轮应换成官方的平台分发包
   （按 target triple 取），并核对 Node 版本（产物 `target: node22`，跟
   `package.json` 的 `engines` 一致）。
5. **`better-sqlite3` 的 `.node` 是构建机上的 prebuild**：只对本机平台有效。
   跨平台打包要在对应平台装依赖（或换成 prebuild 下载对应 ABI/平台的那一份）。
6. **`run.cjs` 的兜底没测过**：它把启动失败打成一行中文日志再 `exit(1)`。真机没跑过。
7. **服务端没有「我起来了」的信号**（`docs/TAURI-PACKAGING.md` 的 D6）：现在壳拉起来
   就不管了，不轮询端口。窗口可能先于服务可用而显示「连不上后端」。
   第一段没做，因为需要动 `apps/server`（加一个就绪输出或健康轮询），
   而那属于「改服务端」，先不动。
8. **`GIT_NEST_CORS` 的值是「照仓库里既有的判断写的」，不是真机实测的**：
   Windows 用 `http://tauri.localhost`、其余用 `tauri://localhost`。
   依据是 `apps/server/src/config.ts` 的 `config.tauriOrigins` 默认清单
   （`tauri://localhost,http://tauri.localhost,https://tauri.localhost`）与
   `app.ts:135` 把它并进 `allowedOrigins()` —— 也就是说**服务端本来就已经认这三个来源**，
   壳这一步只是把它显式化，不依赖默认值。
   核实办法：打包形态起来后，在 webview devtools 里执行 `location.origin`；
   若与上面不符，改 `src/lib.rs` 的 `webview_origin()` 一行即可。

## 怎么验证「人能看见」那一步

`src-tauri/README.md` 有确切的命令与预期现象。要点：dev 形态要**两个终端**
（`pnpm dev` 提供界面与 API，`pnpm desktop:dev` 提供窗口），
而 `pnpm desktop:dev` 里已经串了 `desktop:gen` 与 `desktop:sidecar`
（少了 sidecar，`tauri dev` 的构建阶段会直接因为 externalBin 不存在而失败）。
