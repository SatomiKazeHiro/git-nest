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

### 3. `tauri build --no-bundle` 真的过了（2026-10-13 本轮实测）

```
   Compiling git-nest v0.1.0 (D:\Git\personal\git-nest\src-tauri)
    Finished `release` profile [optimized] target(s) in 2m 58s
       Built application at: D:\Git\personal\git-nest\src-tauri\target\release\git-nest.exe
```

它跑到了**打包**那一步（不是只到 check），所以图标、`externalBin`、`resources`
这条链都是通的。**但第一版的结论是错的**，见下一节——`--no-bundle` 的暂存目录
**不能**用来判断「装出来长什么样」。

### 3.1 `--no-bundle` 的暂存目录骗了我一次（已修，教训记在这里）

**证据**：完整打包（`pnpm desktop:build`，MSI 36.80 MiB + NSIS 25.14 MiB）生成的
WiX 清单 `src-tauri/target/release/wix/x64/main.wxs` 里，资源的目录嵌套是

```
<Directory Name="binaries">
  <Directory Name="node-resources">
    <Directory Name="git-nest-server">
      <File Name="index.mjs" Source="…\binaries\node-resources\git-nest-server\index.mjs" />
```

**`binaries/node-resources/` 这一层没有被剥掉** ✗ —— 装出来是
`<resource_dir>/binaries/node-resources/git-nest-server/index.mjs`。

**我原来的结论**：以为 `resources` 会把 glob 里带前缀的那层目录剥掉，于是
`lib.rs` 解析的是 `resource_dir/git-nest-server/index.mjs` ✗✗。那样 release 起来
只会打一行「没找到 sidecar 启动脚本」，服务不起。

**错在哪**：我是从 `tauri build --no-bundle` 的暂存目录
（`target/release/binaries/node-resources/git-nest-server/…`）**推断**的，
而那个形状恰好和期望值只差一层、看着「像是被处理过」。
`--no-bundle` 只把资源**摆到暂存位置**，真正的目录结构由打包器决定。

**结论（以后照这条做）**：**Tauri 的 `resources` 保留 glob 的目录结构，不剥前缀。**
验「资源落点对不对」的权威依据是**打包器生成的清单**——
Windows 上是 `target/release/wix/x64/main.wxs`（WiX）或 NSIS 的脚本；
**不用安装就能在打包机上看**。

**改法（选了 (a)）**：改 `lib.rs` 的解析路径为
`binaries/node-resources/git-nest-server/index.mjs`（一行），保留现有构建产物布局。
没选 (b)（改 `resources` 写法让前缀真的落成 `git-nest-server/**`），因为那要先核实
v2 的 `resources` 到底支持哪种映射形态——而 (a) 改动面最小、且布局已经跑通过一遍。

顺带记下两条路的命名规则**不一样**（都在清单里能看到）：

| 路 | 落点 | 命名 |
|---|---|---|
| `externalBin` | 可执行文件所在目录 | `<File Name="git-nest-server.exe">`——**去掉** `-<triple>` 后缀 |
| `resources` | `<resource_dir>` 下**保留** glob 的目录结构 | 原名不动 |

**但 release 二进制在本会话里起不到能跑 `setup` 的那一步**：
`Failed to setup app: 拒绝访问。 (os error 5)`（`tauri-2.12.3/src/app.rs:1444`）——
WebView2 建窗口被拒，本会话没有交互式桌面会话。所以「壳真的把 sidecar 拉起来了」
这一条**仍然没有验到**，见下面的差距清单第 1 条。

### 4. 壳这一侧已经接好（但**没能**真机验证）

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

### 5. 界面知道 API 在哪了（差距清单第 2 条已补）

打包形态下没有 vite 代理，相对路径 `/api` 会打到 webview 自己身上。现在由壳注入：

- **壳**：`src/lib.rs` 的 `create_main_window()` 用
  `WebviewWindowBuilder::initialization_script` 在**页面任何脚本之前**写入
  `globalThis.__GIT_NEST_API_BASE__ = "http://127.0.0.1:<API_PORT>"`。
  端口来自 `build.rs` 从 `packages/core/src/types.ts` 生成的常量（Rust 侧仍无第二份数字）。
  **代价**：窗口的标题/尺寸从 `tauri.conf.json` 的 `app.windows` 搬到了 Rust——
  因为 `app.windows` 里建的窗口没法在建之前注入（`setup` 里补 `eval` 会和首屏请求赛跑）。
- **前端收口**：`apps/web/src/lib/api.ts` 的 `apiUrl(path)`。三个调用点全改到它：
  `fetch`（`lib/api.ts` 自己）、`EventSource`（`features/updates/taskStream.ts`）、
  `<img src>`（`features/projects/ProjectLogo.tsx`）。
- **回归闸门**：`lib/apiUrl.guard.test.ts` + `lib/apiUrl.scan.ts` 扫全部应用源码，
  禁止 `api.ts` / 扫描器自身之外出现裸 `/api` 字面量——因为漏一处的后果是**静默**的
  （只在打包后现形，dev 与全部现有测试都是绿的）。
- **不涉及 capability / 权限**：初始化脚本是壳建窗时自己提供的，不是前端调 Tauri 命令，
  不经过 IPC 与 ACL。

## 还差什么（逐条，别把这部分当已完成）

1. **壳真的把 sidecar 拉起来了吗——仍然没验到** ✗（本轮最实质的缺口）。
   `tauri build --no-bundle` 过了，落点也对上了（见下），release 二进制也**能启动**，
   但**它在本会话里起不到能跑 `setup` 的那一步**：直接崩在
   `Failed to setup app: 拒绝访问。 (os error 5)`
   （`tauri-2.12.3/src/app.rs:1444`）——这是 **WebView2 建窗口被拒**，
   属于本会话没有交互式桌面会话的环境限制，不是代码问题。
   所以 `spawn_api_server()` 在 release 下的整条路径（`resource_dir()` 解析、
   `current_exe()` 旁边的 exe、`GIT_NEST_CORS`、`app_data_dir()` 落库）**都还没真机跑过**。
   要真验到，得在一个有桌面会话的机器上跑 `src-tauri/target/release/git-nest.exe`。

   **已经验到的替代证据**（比 `cargo check` 强，比真机弱）：
   - `target/release/git-nest-server.exe` 存在（Tauri 把 `-<triple>` 后缀去掉了，
     与 `sidecar_exe_name()` 拼的名字一致 ✓）；
   - 资源落点以 **WiX 清单**为准（`target/release/wix/x64/main.wxs`）：
     `<resource_dir>/binaries/node-resources/git-nest-server/{index.mjs,run.cjs,README.txt,node_modules/}`
     ——与其路径形态**逐字对上**（见上面 3.1；这一条最初写错过，已修）。
2. ~~**前端还不知道 API 在哪**~~ → **已做**（见第 3 节；`apps/web/src/lib/api.ts` 的
   `apiUrl()` 收口 + 壳的 `initialization_script` 注入）。
   仍然**没能在打包形态下真机验到**：只能用单测证明「注入后 fetch 与 EventSource 都打到
   注入地址」，而「壳真的把那个全局量写进了页面」这一步要等有桌面会话的机器。
3. **Node 运行时的分发方式只是权宜**：现在是复制**构建机的** `node.exe`（约 80 MB），
   所以产物与构建机同平台，也没有版本校验。出安装包那一轮应换成官方的平台分发包
   （按 target triple 取），并核对 Node 版本（产物 `target: node22`，跟
   `package.json` 的 `engines` 一致）。
4. **`better-sqlite3` 的 `.node` 是构建机上的 prebuild**：只对本机平台有效。
   跨平台打包要在对应平台装依赖（或换成 prebuild 下载对应 ABI/平台的那一份）。
5. **`run.cjs` 的兜底没测过**：它把启动失败打成一行中文日志再 `exit(1)`。真机没跑过。
6. **服务端没有「我起来了」的信号**（`docs/TAURI-PACKAGING.md` 的 D6）：现在壳拉起来
   就不管了，不轮询端口。窗口可能先于服务可用而显示「连不上后端」。
   第一段没做，因为需要动 `apps/server`（加一个就绪输出或健康轮询），
   而那属于「改服务端」，先不动。
7. **`GIT_NEST_CORS` 的值是「照仓库里既有的判断写的」，不是真机实测的**：
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
