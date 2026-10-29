# src-tauri —— Tauri 2 桌面壳

这一层是壳，不是应用本体。界面在 `apps/web`，API 在 `apps/server`（Node）。

## 现在能做什么

| 命令 | 作用 | 前置 |
|---|---|---|
| `pnpm desktop:gen` | 从 `packages/core` 生成 `gen/app.config.json`（`devUrl` 在那里，端口只有 core 一份定义） | 无 |
| `pnpm desktop:icons` | 生成占位图标（已存在则跳过，`--force` 覆盖） | 无 |
| `pnpm desktop:sidecar` | 把 `apps/server` 打成可分发的 sidecar 产物 | 无 |
| `pnpm desktop:check` | `cargo check`（壳能不能编译） | Rust 工具链 |
| `pnpm desktop:dev` | 起窗口，指向本机 vite 上的界面 | **先起 `pnpm dev`** |
| `pnpm desktop:release` | 编 release + 铺资源，**不打安装包**；产物直接可跑 | 无 |
| `pnpm desktop:build` | 同上，**并出 MSI/NSIS 安装包**（交付时才需要） | 无 |

### 人能看见的那一步

```bash
# 终端 1：起后端与界面（沿用现有的 dev 流程，没有改动）
pnpm dev

# 终端 2：把桌面窗口挂上去
pnpm desktop:dev
```

应该看到：一个标题为 `git-nest` 的窗口（1280×840，居中）打开，里面是**真实界面**
（左栏分类、项目列表、顶部标题栏），和你在浏览器里看到的一样。
两条命令都别关：终端 1 提供界面与 API，终端 2 提供窗口。

### 不安装也能测 release（日常就用这层）

```bash
pnpm desktop:release
# 然后直接跑（双击也行）：
src-tauri\target\release\git-nest.exe
```

**为什么这样跑就等于「装完跑」**：`target/release/` 的布局**就是安装后的布局** ——
`git-nest.exe` + `git-nest-server.exe`（随包的 Node 运行时）+ `binaries/node-resources/**`
（服务本体与原生模块）。安装器做的事只是把这份布局复制到目标目录，所以差别只剩
「装到哪、按什么权限落位」。

`--no-bundle` 是关键：它只编 release + 铺资源，**不跑 NSIS/WiX** ——
打包慢，而且与「应用能不能用」无关，属于交付那一步的事。

release 档与 dev 档的**关键区别**（这也是必须单独测它的原因）：

| | dev（`desktop:dev`） | release（`desktop:release`） |
|---|---|---|
| 界面从哪来 | vite（36378，有 HMR） | **编译期内嵌**进二进制（不需要 `pnpm dev`） |
| 服务谁提供 | `pnpm dev`（壳**不拉** sidecar） | **壳自己拉 sidecar** |
| 数据放哪 | `target/debug/git-nest-data/` | `target/release/git-nest-data/` |
| 日志 | `target/debug/…/logs/git-nest.log` | `target/release/…/logs/git-nest.log` |

**注意界面是编译期内嵌的**，所以 `desktop:release` 里 `pnpm -C apps/web build` 必须在
`tauri build` **之前**跑完。顺序错了会把**旧的 `apps/web/dist`** 嵌进去，
表现成「改了界面却没生效」——很难往「构建顺序」上想。

**最快判据（不用盯屏幕）**：

```powershell
Get-Content src-tauri\target\release\git-nest-data\logs\git-nest.log -Tail 30
```

有 `incoming request`（跟着一条 `request completed` + `statusCode:200`）= **前端真的
打到了 sidecar**，整条链路通了。没有它、或看到 sidecar 退出/端口占用，就是那条路断了。
这比「看窗口里有没有内容」快得多，也不需要人看。

### 三层的分工（别混用）

| 改什么 | 用哪条 | 代价 | 测不到什么 |
|---|---|---|---|
| 界面 | `pnpm desktop:dev` | 快，有 HMR | **不走 sidecar** ✗ —— 服务是 `pnpm dev` 提供的 |
| 壳 / sidecar / 注入 / CSP / 数据目录 | `pnpm desktop:release` + 跑那个 exe | 一轮几十秒 | 打包器本身、安装位置与权限 |
| 安装包 | `pnpm desktop:build` 后真的装一次 | 最慢 | —— |

**安装只留到最后一步**：它额外验的只有「打包器本身」和「文件有没有按
per-machine / per-user 规则落对位置」，与「应用能不能用」无关。

### 为什么 dev 要两条命令

`tauri dev` 需要一个「前端开发服务器地址」（`build.devUrl`），而**界面不在 Tauri 的
目录里**——它在 `apps/web`，由 vite 提供。这个仓库刻意不把 vite 塞进
`beforeDevCommand`：`pnpm dev` 已经在别处被广泛使用（README、测试、别人写的脚本
都会调它），把它的启动方式藏进 `tauri.conf.json` 会让「界面怎么起来的」多一个隐蔽入口。
代价是 dev 要开两个终端——写在上面那张表里，比藏起来好。

### 为什么要有 `gen/app.config.json`

`build.devUrl` 里的端口必须和 `DEFAULT_PORTS.web`（`packages/core/src/types.ts`）
一致。Tauri 的配置是静态 JSON、没有插值，所以抄一遍数字就会有一个「改了 core
忘了改它」的洞：窗口会打开**另一个**服务，或者干脆白屏。
`src-tauri/build.rs` 因此在编译期从 core 读出端口，生成
`gen/app.config.json`（`tauri.conf.json` 里刻意**不写** `devUrl`），
`desktop:gen` / `desktop:dev` / `desktop:build` 都会先跑它。

`gen/` 是生成物，进 `.gitignore`；`tauri.conf.json` 是手写的、进版本库。

## v2 的形态（不是 v1）

| 位置 | 值 |
|---|---|
| `package.json` 的 `@tauri-apps/cli` | `^2` |
| `Cargo.toml` 的 `tauri` / `tauri-build` / `tauri-plugin-shell` | `"2"`（`tauri-build` 在 `[build-dependencies]`） |
| `tauri.conf.json` 的 `$schema` | `https://schema.tauri.app/config/2` |
| 权限 | `capabilities/*.json` 的 `permissions`（v1 的 `tauri.allowlist` 在 v2 已不存在） |

v2 的 `app.security.csp` **不是** `null`：理由见下面「CSP 为什么长这样」。

## 图标是占位的

`icons/` 下六枚（`32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、
`icon.ico`、`icon.icns`）由 `scripts/gen-tauri-icons.mjs` 生成——纯色方块加一条
对角带，**不是**设计资源，只是为了满足 Tauri 打包时对图标的硬性要求。
换美术资源时直接覆盖这几个文件即可（`--force` 会重新生成占位图，别在真图标上跑）。

## CSP 为什么长这样

`app.security.csp`：

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
img-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost http://localhost:* http://127.0.0.1:* ws://localhost:*
```

逐条的理由（都是照着这个应用**实际**加载的东西写的，不是抄模板）：

- `default-src 'self'`：兜底只认自己。桌面形态下页面来源是
  `http://tauri.localhost`（Windows）/ `tauri://localhost`（macOS、Linux），
  静态资源就是打包进去的那些。
- `script-src 'self'`：**没有** `'unsafe-inline'`、**没有** `'unsafe-eval'`。
  页面里没有内联 `<script>`（见 `apps/web/index.html`），构建产物是外链 JS。
- `style-src` 需要 `'unsafe-inline'`：界面用了 React 的 `style={{…}}`（内联 style
  属性在 CSP 里也归这一档）。这是当前代码的真实需要，不是想当然。
  `https://fonts.googleapis.com` 是那支字体样式表（见下）。
- `font-src https://fonts.gstatic.com`：字体文件的真正来源。
- `img-src 'self' data:`：项目 logo 走同源接口 `/api/projects/:id/logo`；
  **README 里的图片只放行内联 `data:image/*`**（`apps/web/src/features/readme/urlPolicy.ts`，
  有测试钉着）。所以这里**不需要** `https:`，也不需要 `blob:`——写上去只会白放宽。
- `connect-src`：`ipc:` / `http://ipc.localhost` 是 Tauri v2 自己的 IPC 通道
  （少了它前端的 Tauri 调用全废）；`http://localhost:*` / `http://127.0.0.1:*` 是
  **API 服务**。端口写的是**通配**而不是钉死 36379：端口可以通过 `GIT_NEST_PORT`
  覆盖（见 README），钉死会让「改了端口」和「CSP 拦住了」同时发生，
  而后者不会告诉你原因。
  `ws://localhost:*` 是给 dev 形态的 vite HMR 用的：CSP 的 scheme 匹配不认
  `http:` → `ws:`，少这一条，桌面壳里的热更新会静默失效（打包形态用不到它）。

### 一处需要你知道的取舍：远程字体

`apps/web/index.html` 里有 Google Fonts（`fonts.googleapis.com` /
`fonts.gstatic.com`）那两条链接，是**之前就有的**、刻意做成非阻塞的（首屏不等它，
加载不到就用 `index.css` 里的回退字体）。上面这份 CSP **放行了它**，也就是保留了
「桌面应用启动时会往外部发一个请求」这件事。

- 保留：dev 与打包后看起来一致。
- 想要更严（桌面应用不联网取字体），删掉 `style-src` 里的
  `https://fonts.googleapis.com` 和整条 `font-src` 即可，界面回退到系统字体，
  其余不受影响。

这件事没有默认答案，所以在这里写明，而不是留在配置里让人猜。

## 数据放在哪：**永远在 exe 旁边**

```
<exe 所在目录>\git-nest-data\
  git-nest.db      ← 清单数据库
  EBWebView\       ← WebView2 的用户数据（Chromium 那套缓存/存储）
  logs\
    git-nest.log   ← 壳与 sidecar 的日志（见下）
```

- 便携版 = 把整个目录拷走，数据跟着走 ✓
- 安装版 = **装在哪个目录，数据就在哪个目录** ✓
- **`GIT_NEST_DATA_DIR`** 是唯一的**显式覆盖**（逃生口），优先级最高
- **写不进去就大声失败并中止启动** ✗（不再有「悄悄退回 `%LOCALAPPDATA%`」那一档）——
  报错里会写清想写哪儿、为什么写不了、三条出路（换安装目录 / 设 `GIT_NEST_DATA_DIR` / 用便携版）；
  那一刻日志系统还没起来，所以它同时会尽力落一份
  `<exe 目录>\git-nest-startup-error.log`（写不成再试 `%TEMP%`）

### 出问题时先看日志

`<数据根>\logs\git-nest.log`。**用户在资源管理器里双击启动时没有控制台**，
这份文件是唯一的线索来源；它同时收壳自己的消息和 **sidecar（Node）的 stdout/stderr**。

这条是付过代价的：装了 MSI 之后界面报「后端没启动」，而真正说明原因的那几行
（`Error: EISDIR: illegal operation on a directory, lstat 'D:'`）是 **Node** 打出来的
——当时壳只会 `eprintln!`，双击启动就等于什么都没有，只有从终端跑才看得见。
现在两处都写进这个文件。

**为什么需要一个可写的安装位置**：这条规则意味着 exe 目录必须可写。
`C:\Program Files\...` 对非提权进程是**只读**的，所以：

| 安装包 | 默认装到哪 | 可写？ |
|---|---|---|
| NSIS（`*-setup.exe`） | `%LOCALAPPDATA%\Programs\git-nest\`（`installMode: currentUser`） | ✓ 不需要管理员/UAC |
| MSI（`*.msi`） | `Program Files`（WiX 不支持每用户，我核过内嵌 schema） | ✗ → 安装向导里**改目录**，或设 `GIT_NEST_DATA_DIR` |

**另一条必须知道的原因**：`WEBVIEW2_USER_DATA_FOLDER` 被设成 `<数据根>\EBWebView`，
而它**必须在建窗之前**设好（WebView2 在建 environment 的那一刻读它）。
这台机器上 WebView2 的默认位置（C 盘 `%LOCALAPPDATA%`）**建不起 environment**，
窗口直接崩在 `WindowsError(0x8000FFFF, "灾难性故障")`——把数据挪到 exe 旁边
顺带把这个问题一起解决了。实测证据与三组对照见 [`SIDECAR.md`](./SIDECAR.md) 的 3.2 / 3.3。

dev 形态下 exe 在 `src-tauri/target/debug/`，所以数据落在
`src-tauri/target/debug/git-nest-data/`（`target/` 已在 `.gitignore` 里）。

## 界面怎么知道 API 在哪（打包形态下唯一挡住「能用」的事）

浏览器里开发时，`/api` 是相对路径、由 vite 代理转到 36379——**代理是 dev server 的功能**。
打包后没有 dev server、没有代理，页面的来源变成 Tauri 的自定义协议，
相对路径 `/api` 会打到 **webview 自己身上**，一个请求都到不了服务端。
所以地址在打包形态下必须由壳给：

- 壳在**页面加载之前**注入 `globalThis.__GIT_NEST_API_BASE__`；
- 前端所有 `/api` 拼接都走 `apps/web/src/lib/api.ts` 的 `apiUrl()`（唯一收口）；
- 拿不到注入值（浏览器开发、全部现有测试）→ 退回相对路径，行为与从前**一模一样**。

### 为什么窗口在 Rust 里建，而不是写在 `tauri.conf.json` 的 `app.windows`

**只为了注入时机。** 另一条路（配置里建窗口 + `setup` 里 `window.eval(...)` 补注入）
不可靠：`setup` 时页面已经开始加载，而界面一挂载就发请求，两者在赛跑——
打包后偶发「第一个请求打错地址」，这种时序 bug 极难复现。
`WebviewWindowBuilder::initialization_script` 是**页面任何脚本之前**执行，不存在赛跑。

代价：窗口的标题/尺寸/居中从 JSON 搬到了 `src/lib.rs`（形状与原来的配置相同：
1280×840、最小 960×600、居中、可缩放）。

### 为什么不是构建期用 Vite `define` 钉死端口

端口可被 `GIT_NEST_PORT` 覆盖。构建期钉死会制造一个很难查的组合故障：
用户改了端口 → 服务端监听新端口、前端还在打旧端口 → 报「连不上后端」，
而那条报错**不会告诉你是端口没跟上**。这与下面 CSP 的 `connect-src` 只写 host、
不写端口是同一个道理：地址是**运行期事实**，不该在构建期定稿。

这件事**不需要任何 capability / 权限**：初始化脚本是壳在建窗口时自己提供的，
不是前端调用 Tauri 的命令，不经过 IPC 与 ACL。

## 页面起不来时，窗口不能没有关闭按钮

窗口是 `decorations(false)` 建的，最小化/最大化/关闭按钮是**前端
`components/TitleBar.tsx` 画的**。所以「页面没加载成功」（JS 崩了、构建坏了、
启动方式不对）会留下一个**连关闭按钮都没有**的窗口——只能从任务栏右键关（实测踩过）。

兜底是壳侧的一条看门狗（`src/lib.rs` 的 `watch_title_bar`）：

- 前端挂载成功后调一次 `app_mounted` 命令上报存活（`apps/web/src/lib/platform.ts`
  的 `notifyAppMounted()`，浏览器环境里是静默 no-op）；
- 壳建窗后等 **15 秒**：收到上报，什么都不做（成功路径零变化）；超时没收到，
  `set_decorations(true)` 把系统标题栏还回来，并在日志里写明原因。

这是壳里**唯一**的自定义命令，所以也多了一样东西：`permissions/app-mounted.toml`。
Tauri 2 不给应用自己的命令自动生成权限——「自定义命令 + capability 引用
`allow-app-mounted`」中间必须有那份定义，否则编译期就报
`Permission allow-app-mounted not found`。

## sidecar（Node 服务）现在到哪一步了

选了 **A：把 Node 当 sidecar 打进包**（理由与差距逐条见
[`SIDECAR.md`](./SIDECAR.md)）。

## 目录里都有什么

```
build.rs                       生成端口常量 + gen/app.config.json，然后调 tauri_build
src/main.rs                    一行入口，调 lib 的 run()
src/lib.rs                     壳的组装 + 建窗并注入 API 地址 + sidecar 的拉起/关停 + 数据目录
capabilities/main-window.json  v2 的权限声明（替代 v1 的 allowlist）
permissions/                   自定义命令的权限定义（app_mounted）
tauri.conf.json                v2 配置（$schema 指 config/2）；窗口不在这里（见上）
gen/                           生成物（app.config.json、schemas），进 .gitignore
binaries/                      sidecar 产物，进 .gitignore
icons/                         占位图标
```
