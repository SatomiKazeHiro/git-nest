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
connect-src 'self' ipc: http://ipc.localhost http://localhost http://127.0.0.1
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
  （少了它前端的 Tauri 调用全废）；`http://localhost` / `http://127.0.0.1` 是
  **API 服务**。这里刻意**只写到 host、不写端口**：端口可以通过 `GIT_NEST_PORT`
  覆盖（见 README），钉死 36379 会让「改了端口」和「CSP 拦住了」同时发生，
  而后者不会告诉你原因。

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
```

- 便携版 = 把整个目录拷走，数据跟着走 ✓
- 安装版 = **装在哪个目录，数据就在哪个目录** ✓
- **`GIT_NEST_DATA_DIR`** 是唯一的**显式覆盖**（逃生口），优先级最高
- **写不进去就大声失败并中止启动** ✗（不再有「悄悄退回 `%LOCALAPPDATA%`」那一档）——
  报错里会写清想写哪儿、为什么写不了、三条出路（换安装目录 / 设 `GIT_NEST_DATA_DIR` / 用便携版）

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

## sidecar（Node 服务）现在到哪一步了

选了 **A：把 Node 当 sidecar 打进包**（理由与差距逐条见
[`SIDECAR.md`](./SIDECAR.md)）。

## 目录里都有什么

```
build.rs                       生成端口常量 + gen/app.config.json，然后调 tauri_build
src/main.rs                    一行入口，调 lib 的 run()
src/lib.rs                     壳的组装 + 建窗并注入 API 地址 + sidecar 的拉起/关停 + 数据目录
capabilities/main-window.json  v2 的权限声明（替代 v1 的 allowlist）
tauri.conf.json                v2 配置（$schema 指 config/2）；窗口不在这里（见上）
gen/                           生成物（app.config.json、schemas），进 .gitignore
binaries/                      sidecar 产物，进 .gitignore
icons/                         占位图标
```
