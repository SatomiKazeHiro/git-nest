# git-nest

本机仓库清单：把散在各处的 git 仓库收进一张表，看它们**现在什么状态、落后多少、推不推荐更新**，并在你勾选之后批量更新。

**它不会自己联网。** 扫描目录、读状态、看 README 全在本机做；只有你按下「联网检查更新」时才会 fetch 远程。更新**永远**由你勾选触发，且只做 fast-forward——不产生 merge commit，绝不动你的工作区。

## 跑起来

需要 **Node ≥ 22** 与 **pnpm**（仓库用 pnpm workspace）。

```bash
pnpm install
pnpm dev            # 同时起服务端与界面
```

| | 地址 | 能不能改 |
|---|---|---|
| 界面（Vite） | http://localhost:36378 | `GIT_NEST_API`（Vite 代理指向哪） |
| 本机 API（Fastify） | http://127.0.0.1:36379 | `GIT_NEST_PORT`；跨站白名单用 `GIT_NEST_CORS` |

三个环境变量的默认值只在 `packages/core/src/types.ts` 的 `DEFAULT_PORTS` 里写一次，两端都读它——**改端口只改那一处**（漏改 CORS 那处的话，界面每个写操作都会 403，而报错不会告诉你是端口没跟上）。

数据存在 `data/git-nest.db`（本机 SQLite，不进版本库）。

> 桌面壳（`src-tauri/`）打包后数据**不在**这里，而在
> `<exe 所在目录>/git-nest-data/`（`git-nest.db` + WebView2 的用户数据）。
> 理由、覆盖方式与安装位置的要求见 [`src-tauri/README.md`](src-tauri/README.md)。

## 常用脚本

```bash
pnpm dev:server     # 只起 API
pnpm dev:web        # 只起界面
pnpm typecheck      # 三个包各跑一遍
pnpm test           # 全量测试
pnpm build          # 构建
pnpm check:encoding # 检查编码（有几个刻意的 fixture 会被报出来，属正常）
```

## 桌面壳（Tauri 2，第一段）

壳在 `src-tauri/`，**还没到出安装包那一步**。dev 形态要**两个终端**：界面与 API 仍由
现有的 `pnpm dev` 提供（壳不改这件事），壳只把窗口挂到 vite 上。

```bash
pnpm dev            # 终端 1：界面（36378）+ API（36379）
pnpm desktop:dev    # 终端 2：打开 git-nest 窗口
```

应该看到一个标题 `git-nest`、1280×840 居中的窗口，里面是真实界面。

其余脚本（`desktop:gen` / `desktop:icons` / `desktop:sidecar` / `desktop:check` /
`desktop:build`）的职责，以及「为什么 dev 不用 `beforeDevCommand`」「CSP 为什么长这样」
「sidecar 还差什么」，都写在
[`src-tauri/README.md`](src-tauri/README.md) 与 [`src-tauri/SIDECAR.md`](src-tauri/SIDECAR.md)。

## 文档

- [`docs/DESIGN.md`](docs/DESIGN.md)——**设计原则与界面约定**（这份是"为什么这么做"的正本，README 不复制它）
- [`docs/DETAIL-OVERLAY.md`](docs/DETAIL-OVERLAY.md)——详情浮层的方案与**排期**（等 Tauri 封装之后）
- [`docs/LIST-SCALE.md`](docs/LIST-SCALE.md)——列表规模那一轮（分页 / 虚拟化）的方案与**排期**
- [`docs/TAURI-PACKAGING.md`](docs/TAURI-PACKAGING.md)——桌面包的**备案**（已核实的事实与待定决策）
- [`src-tauri/SIDECAR.md`](src-tauri/SIDECAR.md)——Node 服务随包分发的**进度与差距清单**

## 源码结构

```
apps/server   Fastify + better-sqlite3；算状态、存清单、跑 git
apps/web      React + Vite；只渲染服务端算好的结论
packages/core 两端共用的类型、schema、常量（浏览器安全那份在这里）
src-tauri     Tauri 2 桌面壳（Rust）；dev 只提供窗口，打包时负责拉起 Node 服务
```
