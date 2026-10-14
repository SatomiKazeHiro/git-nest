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

**当初以为是「本会话没有交互式桌面会话」，那个判断是错的** ✗ —— 真正的根因见下一节，
而且它已经被修掉了，**窗口现在起得来**。

### 3.2 根因与修复：WebView2 的用户数据目录（**实测已解决**）

**谁发现的**：用户问了一句「是不是有数据放在 C 盘、能不能放到 exe 所在目录」，
一句话点破了绕了半天的 `0x8000FFFF`。

**三组对照（上游跑的）**：

| 组 | WebView2 用户数据目录 | 结果 |
|---|---|---|
| ① | 默认（`%LOCALAPPDATA%\dev.git-nest.desktop\EBWebView`，**C 盘**） | `exit=101`，`failed to create webview: WindowsError(0x8000FFFF, "灾难性故障")`（`E_UNEXPECTED`） |
| ② | `WEBVIEW2_USER_DATA_FOLDER = <exe 目录>\EBWebView`（**D 盘**） | ★ 进程不崩、`msedgewebview2.exe` 子进程起来、exe 旁边真的建出了 `EBWebView/` |
| ③ | ② + `GIT_NEST_DB` 也放 D 盘 | 同样活着 |

**之前那条「换到 `%TEMP%` 也没用」的结论也是错的** ✗ —— `%TEMP%` 也在 C 盘，
那次没把「换目录」和「换卷」区分开。所以这不是「换了个目录」，是**换了卷**。

**我在自己会话里复现了**（debug 二进制，`cargo build` 后直接跑）：

```
启动前数据目录存在? False
spawned pid=11856
12 秒后主进程还活着? True
--- msedgewebview2 子进程数（>0 = webview 真的建起来了）---
12
--- 数据目录是否建在 exe 旁边 ---
EBWebView
--- EBWebView 里有没有东西 ---
172
--- 壳的 stderr ---
[git-nest] 数据根：D:\Git\personal\git-nest\src-tauri\target\debug\git-nest-data
[git-nest] WEBVIEW2_USER_DATA_FOLDER = D:\Git\personal\git-nest\src-tauri\target\debug\git-nest-data\EBWebView
[git-nest] 已建主窗口，并注入 API 基地址 http://127.0.0.1:36379
[git-nest] dev 形态：服务由 `pnpm dev` 提供（/api 走 vite 代理），壳不拉 sidecar
```

对照着看：改之前同样的跑法是**立刻** `exit=101` + `Failed to setup app`；
现在进程活着、12 个 webview 子进程、`EBWebView/` 里落了 172 个文件。
最后一行也顺带证明**第三行的注入确实执行了**（它在 `build()` 成功之后才打印）。

### 3.3 数据根：**永远在 exe 旁边**（用户定死的规则）

```
<exe 所在目录>\git-nest-data\
  git-nest.db      ← 清单数据库（传给 sidecar 的 GIT_NEST_DB）
  EBWebView\       ← WebView2 的用户数据（WEBVIEW2_USER_DATA_FOLDER）
```

- **`GIT_NEST_DATA_DIR`** 是唯一的**显式覆盖**（「我知道自己在做什么」的逃生口），优先级最高。
- **没有「退回系统数据目录」那一档** ✗ —— 早先那版是「exe 目录不可写 → 悄悄退到
  `%LOCALAPPDATA%`」，**那个行为是错的**：它正是用户要消除的东西（数据跑到用户没指定的
  地方），而且在这台机器上还会直接把窗口搞死（C 盘那个位置 WebView2 建不起 environment）。
- **写不进去就大声失败**：说清想写哪儿、为什么写不了、三条出路
  （换可写的安装目录 / 设 `GIT_NEST_DATA_DIR` / 用便携版），然后中止启动。
  **绝不悄悄换个地方写。**
- 判据是**真的写一个文件再删掉**，不是看权限位或 `create_dir_all` 是否成功：
  目录已存在但只读时 `create_dir_all` 会成功返回，Windows 上「属性里看着可写、实际 ACL 拒绝」
  很常见（Program Files 就是）。
- 决定数据根的 `choose_data_root()` 是**纯函数**（不碰文件系统、不读环境变量），
  所以有 6 条 Rust 单测钉着（`cargo test`）：默认在 exe 旁边 / 显式覆盖优先 /
  不可写时大声失败且给出三条出路 / 拿不到 exe 目录时给逃生口 / 探测真的会失败（反向验证）。

### 3.4 默认安装位置必须是**可写的**（否则上面那条会变成「装完打不开」）

`C:\Program Files\...` 对非提权进程是只读的 → 数据写不进去 → 按 3.3 那个规则就是启动失败。
所以安装方式必须跟着改：

**NSIS（`git-nest_0.1.0_x64-setup.exe`）** —— 已配成每用户：

```json
"bundle": { "windows": { "nsis": { "installMode": "currentUser" } } }
```

依据是**我们实际用的那个 CLI 版本的内嵌 schema**（`@tauri-apps/cli` 2.12.2 的
`cli.win32-x64-msvc.node` 里那段 `"NSISInstallerMode"`）——注意**不是**
`src-tauri/gen/schemas/desktop-schema.json`，那个文件里**根本没有** NSIS/WiX 的类型
（我 grep 过：没有 `installMode`/`currentUser`/`NsisConfig`）。schema 原文：

```
"installMode": {
  "description": "Whether the installation will be for all users or just the current user.",
  "default": "currentUser",
  "allOf": [{ "$ref": "#/definitions/NSISInstallerMode" }]
},
...
"NSISInstallerMode": {
  "description": "Install Modes for the NSIS installer.",
  "oneOf": [
    { "enum": ["currentUser"], ... "Install the app by default in a directory that
       doesn't require Administrator access. Installer metadata will be saved under the HKCU registry path." },
    { "enum": ["perMachine"], ... },
    { "enum": ["both"], ... }
  ]
}
```

也就是说 **`currentUser` 本来就是默认值**（我仍然显式写出来：默认值会随版本变，
写出来才是一份「我们要求它可写」的声明），装到 `%LOCALAPPDATA%\Programs\git-nest\`，
不需要管理员、不需要 UAC。

**MSI（`git-nest_0.1.0_x64_en-US.msi`）—— 这一支没法做成每用户** ✗。
我核过内嵌 schema：`WixConfig` 的字段里**没有** `installMode` 或任何 scope 选项
（字段是 `version`/`upgradeCode`/`language`/`template`/`fragmentPaths`/`items`/
`componentGroupRefs`/`…Refs`/`enableElevatedUpdateTask`/`bannerPath`/`dialogImagePath`/
`fipsCompliant`/`additionalProperties`/`localePath` —— `installMode` 只出现在 `NsisConfig` 里）。
所以 **MSI 是 per-machine、默认装到 `Program Files`**，那种情况下用户必须二选一：

1. **在安装向导里改目标目录**（MSI 允许改）到一个可写的位置；或
2. **设 `GIT_NEST_DATA_DIR`** 指到一个可写的位置。

**不要**为了 MSI 把数据偷偷挪走 ✗ —— 那会把「数据在哪」变成用户猜不到的事。

### 3.5 ★ 装出来的 MSI 报「后端没启动」：Node 解析不了 verbatim 路径（**已修，实测通过**）

**现象**：用户装了 MSI，界面报「后端没启动」。从终端跑那次安装出来的 exe，抓到 stderr：

```
[git-nest] 已拉起 sidecar（入口 \\?\D:\ToolSoftware\git-nest\binaries\node-resources\git-nest-server\index.mjs，
           随包的运行时 D:\ToolSoftware\git-nest\git-nest-server.exe，
           数据库 D:\ToolSoftware\git-nest\git-nest-data\git-nest.db），API 端口 36379   ← 拉起是成功的
[git-nest] Error: EISDIR: illegal operation on a directory, lstat 'D:'
[git-nest]     at Object.realpathSync (node:fs:2749:25)
[git-nest]     at resolveMainPath (node:internal/modules/run_main:39:23)
[git-nest] sidecar 退出，code=Some(1)
```

**根因**：交给 Node 的入口脚本路径带了 Windows 扩展长度前缀 `\\?\`。
`resource_dir()` 在 Windows 上可能给出 verbatim 形式；Rust 自己处理它没问题，
**但 Node 不行**——它把主模块路径解析成了 `D:` → `EISDIR` → **立刻退出** →
`git-nest.db` 从未被创建 → 界面报「后端没启动」。

**为什么隔离冒烟没抓到** ✗✓（这条教训最值钱）：冒烟用的是**普通路径**
（自己在 `%TEMP%` 下拼的），而真实安装形态下 `resource_dir()` 给的是 verbatim 形式
——**冒烟和真实路径恰好差在最要命的那一处**。
**教训：冒烟必须复刻安装后的「布局 + 路径来源」，不能只复刻文件内容。**

**改法**：`strip_verbatim_prefix()`（纯函数，大小写不敏感，UNC 也认）：

| 输入 | 输出 |
|---|---|
| `\\?\D:\x` | `D:\x` |
| `\\?\UNC\server\share\x` | `\\server\share\x` |
| `\\?\unc\…` / `//?/D:/x` | 同样剥掉（大小写与分隔符都认） |
| 没有前缀 | 原样不动（非 Windows 上 `/` 是合法分隔符，不能改写） |

**一处收口**：所有跨进程边界的路径都走 `path_for_child()` —— **入口脚本**（事故就是它）、
`GIT_NEST_DB`、以及 `GIT_NEST_DATA_DIR` 的取值。事故日志里 `GIT_NEST_DB` 恰好是干净的，
但那是运气不是保证，所以一起收掉。

**日志（`tauri-plugin-log`）**：`log_line` 之前只是 `eprintln!`，双击启动时**没有任何线索**
（这次事故的 `Error: EISDIR…` 是 Node 打的，只有从终端跑才看得到）。现在两个 target：

- `Stderr`（dev / 终端里照样看得到）；
- `Folder { path: <数据根>\logs, file_name: "git-nest" }` → `<数据根>\logs\git-nest.log`
  （**跟着数据走**：便携版整个目录拷走，日志一起走）。

sidecar 的 stdout/stderr 也转发进这个日志（所以 Node 的报错也会落盘）。
数据根定不下来时日志插件还没注册，那一刻走 `panic_on_no_data_root()`：
stderr + 尽力写一份 `git-nest-startup-error.log`（exe 旁边，再试 `%TEMP%`）。

**实测（安装后布局，本机 release 二进制，终端里跑）**

按安装后的形状在 `D:\Temp\git-nest-e2e\` 拼了一份（**仓库外**，测完删掉）：
`git-nest.exe` + `git-nest-server.exe` + `binaries\node-resources\git-nest-server\**`
（**没有**第二份 `node.exe` —— 运行时就是 `git-nest-server.exe` 那一支）。

```
启动前：数据目录存在? False
主进程还活着? True
=== sidecar 进程 ===  git-nest-server  Id=23172
=== <exe 目录>\git-nest-data\ 内容 ===
EBWebView   logs   git-nest.db   git-nest.db-shm   git-nest.db-wal
=== GET /api/projects ===  HTTP 200  {"projects":[],"total":0}

[INFO] 数据根：D:\Temp\git-nest-e2e\git-nest-data
[INFO] WEBVIEW2_USER_DATA_FOLDER = D:\Temp\git-nest-e2e\git-nest-data\EBWebView
[INFO] 已建主窗口，并注入 API 基地址 http://127.0.0.1:36379
[INFO] 已拉起 sidecar（入口 D:\Temp\git-nest-e2e\binaries\node-resources\git-nest-server\index.mjs，…，数据库 D:\Temp\git-nest-e2e\git-nest-data\git-nest.db），API 端口 36379
[INFO] {"msg":"Server listening at http://127.0.0.1:36379"}
[INFO] {"msg":"数据库：D:\\Temp\\git-nest-e2e\\git-nest-data\\git-nest.db"}
[INFO] {"reqId":"req-1","req":{"method":"GET","url":"/api/projects"},"msg":"incoming request"}
[INFO] {"reqId":"req-1","res":{"statusCode":200},"msg":"request completed"}
```

- `git-nest.db` 出现在 `<exe 目录>\git-nest-data\` ✓
- `GET /api/projects` = **HTTP 200** ✓
- **没有 `EISDIR`** ✓
- 日志落盘 `<数据根>\logs\git-nest.log`（应用退出后 1657 字节，最后一行是「退出：正在关掉 sidecar」）✓
- 关窗后 sidecar 被一起收掉 ✓（`RunEvent::ExitRequested` 的 kill 生效）

**另外单独压了一次 verbatim 前缀**（把 `GIT_NEST_DATA_DIR` 故意设成 `\\?\D:\…`）：
日志里显示的是**剥掉前缀后**的路径，服务起来了、`GET /api/projects` 仍是 **HTTP 200**、
**没有 EISDIR** ✓ —— 这次修的那个点真的被覆盖到了，不是只靠推断。

### 4. 壳这一侧已经接好（但**没能**真机验证）

- `tauri.conf.json`：`bundle.externalBin: ["binaries/git-nest-server"]` +
  `bundle.resources: ["binaries/node-resources/git-nest-server/**/*"]`
- `tauri-plugin-shell = "2"`（v2 用插件，v1 的 allowlist 已不存在）
- `src/lib.rs` 的 `spawn_api_server()`：只 **release** 拉 sidecar（dev 下前端走 vite
  代理、服务由 `pnpm dev` 提供，壳再拉一个会 EADDRINUSE）；传 `GIT_NEST_PORT`
  （从 `packages/core` 生成）、`GIT_NEST_DB`（`<数据根>/git-nest.db`，见 3.3）、
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

1. ~~**壳真的把 sidecar 拉起来了吗**~~ → **已验到** ✓（见 3.5）：release 二进制 +
   安装后布局（`D:\Temp\git-nest-e2e\`，仓库外），sidecar 起来了、`git-nest.db` 落在
   `<exe 目录>\git-nest-data\`、`GET /api/projects` = **HTTP 200**、无 `EISDIR`、
   日志落盘、关窗后 sidecar 被收掉。
   **仍然没验的**是「真装一次 MSI/NSIS 再跑」这一步：本机装不了（需要交互式安装 + UAC），
   我验的是**与安装后完全相同的目录布局与路径来源**（这正是 3.5 那条教训要求的）。
2. ~~**前端还不知道 API 在哪**~~ → **已做**（见第 5 节；`apps/web/src/lib/api.ts` 的
   `apiUrl()` 收口 + 壳的 `initialization_script` 注入）。
   单测覆盖「注入后 fetch 与 EventSource 都打到注入地址」；日志里
   「已建主窗口，并注入 API 基地址」证明注入那一步执行了——
   但**「页面里真的读到了那个全局量」**要人眼看 webview（唯一剩下的一格：
   装出来后 devtools 里 `globalThis.__GIT_NEST_API_BASE__`），我这一格验不了。
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
