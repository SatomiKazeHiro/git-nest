# git-nest

本地 git 项目管理工具：管理自己的项目 + 追踪网上开源项目的本地克隆。
替代手写 README 项目清单——项目表、备注/tag 元数据、批量更新检测与勾选式更新。

设计与里程碑规划见 [`docs/superpowers/specs/2026-06-20-git-nest-design.md`](docs/superpowers/specs/2026-06-20-git-nest-design.md)。

## 跑起来

```bash
pnpm install
pnpm dev          # server :5174 + web :5173
```

打开 http://localhost:5173 。

单独启动：

```bash
pnpm dev:server
pnpm dev:web
```

其他脚本：

```bash
pnpm typecheck    # 三个包一起 tsc --noEmit
pnpm test         # vitest，core / server / web 三个 project
pnpm build        # 构建 web 产物
```

首次启动会在 `data/git-nest.db` 建库（已 gitignore）。删掉这个文件就回到空清单。

## 结构

```
git-nest/
├── apps/
│   ├── server/   Fastify + better-sqlite3，REST（批量操作的 SSE 留给 M3）
│   └── web/      Vite + React 19 + TanStack Query + React Router + Tailwind v4
└── packages/
    └── core/     共享类型 + zod 校验 + git 执行层，前后端同一份
```

- `packages/core` 无 UI、无 HTTP 依赖，以源码形式被引用（`exports: ./src/index.ts`），改完不用构建。
- **core 有两个入口**：`@git-nest/core`（类型 + zod，浏览器安全）与 `@git-nest/core/git`
  （依赖 `node:child_process`，只能 node 侧引）。别在 barrel 里 `export *` git 层，
  否则浏览器打包会报 `node:child_process has been externalized`。
- 元数据进 SQLite；git 实时状态不落库，每次现查（server 侧 3 秒短缓存，`?fresh=true` 可绕开）。
- 本地绝对路径只存在本机 SQLite 里，不进任何会被提交的文件。

## 前端技术栈怎么用

| 库 | 用途 |
|---|---|
| TanStack Query | 所有服务端状态：清单、详情、标签、批量 git 状态、提交图 |
| Zustand | 纯 UI 状态：筛选条件、行选中、编辑弹窗 |
| Zod | 前后端共用同一份 schema（`packages/core/src/schemas.ts`），前端提交前先校验，错误逐字段显示 |
| ahooks | `useDebounce` 搜索防抖 |
| es-toolkit | `groupBy` 按分类分组、`orderBy` 分类/标签/备注排序 |
| React Router | 三个视图：清单 `/`、详情 `/projects/:id`、设置 `/settings` |
| Tailwind v4 | 设计 token 定义在 `apps/web/src/index.css` 的 `@theme` 里 |

## git 执行层的硬规则

全部实现在 `packages/core/src/git/`，照抄 `.reference/github-kb` 的安全规则：

1. 每次调用都带 `GIT_TERMINAL_PROMPT=0` + `credential.interactive=false`，单命令硬超时
   （默认 120s，`GIT_NEST_GIT_TIMEOUT` 可调）
2. 用 `execFile` + argv 传参，不走 shell——路径与 ref 不用手动加引号，也就没有引号绕过导致的注入
3. **同仓库串行、跨仓库并发上限 4**（`Scheduler`），防 `index.lock` 冲突与远程限流
4. 探测命令逐个执行、单独判退出码：「没有上游」「detached HEAD」是预期内的非零退出
5. `pull` 只允许 `--ff-only`；脏工作区 / detached / 无上游 / 已分叉一律跳过并说清原因
6. 失败按 网络 / 认证 / 锁残留 / 目录丢失 归因，各自给可操作的提示

状态机覆盖的常态分支（不是异常）：`up_to_date` `behind` `ahead` `diverged` `dirty`
`no_upstream` `detached` `no_remote` `no_commits` `missing` `not_a_repo`。

## API

```
GET    /api/projects?category=&tag=&q=
POST   /api/projects              路径必须是已存在的目录；不填 remoteUrl 时从 git 的 origin 自动填
PATCH  /api/projects/:id
DELETE /api/projects/:id          只删 DB 记录，绝不动磁盘仓库
GET    /api/projects/:id/status   实时 git 状态（?fresh=true 绕开短缓存）
GET    /api/projects/:id/log?max= 提交图数据
GET    /api/status?ids=1,2,3      批量状态，列表页一次拿全
GET/POST/PUT/DELETE  /api/tags、/api/projects/:id/tags、/api/projects/:id/notes、/api/notes/:id

GET    /api/settings              读设置
PATCH  /api/settings              改设置（personal 是否参与检查、超时、并发、确认阈值）

POST   /api/updates/check         批量 fetch+分析，202 返回 taskId（ids 省略 = 全部非 personal）
GET    /api/updates/:taskId       任务快照
GET    /api/updates/:taskId/events  进度 SSE（认 Last-Event-ID，断线重连不丢）
POST   /api/updates/apply         对勾选的仓库逐个 pull --ff-only，同样 202 + SSE
```

更新任务为什么是「POST 启动 + GET 订阅」：`EventSource` 只能发 GET，而批量检查可能要联网
fetch 十几个仓库，不能让一个 HTTP 请求一直挂着。任务状态放内存（半小时 TTL），进度事件
用「缓冲数组 + 游标」而不是发布订阅——前端拿到 id 再开连接是常态，缓冲保证不丢事件。

## 已完成

**M1 骨架** — 项目 CRUD、分类/标签/备注元数据、清单页与详情页、标签设置页。
请求体验证统一走 zod，失败返回 422 + 逐字段说明。

**M2 git 状态** — `packages/core` 的 git 执行层（status / log / pull / scan / scheduler /
错误归因）、清单页状态列、详情页 git 状态面板与提交图（自研泳道图，接口隔离在单个组件内，
将来可替换成 react-git-log）。

**M3 更新模块** — 批量检查更新 → 逐仓库分析报告（新增 commit / 新 tag / ahead-behind）→
勾选 → ff-only 更新 → 结果汇总，全程 SSE 推进度。设置页可调 personal 是否参与检查、
git 超时、并发上限、确认阈值。**核心原则：绝不自动更新**，检查只是给建议，
真正动工作区的只有用户勾选后点的那一次。

测试 105 个用例：git 层全部用临时目录里**真实 git 仓库**跑（init → commit → clone →
构造 behind / ahead / diverged / dirty / detached 各状态），不 mock git。

## 还没做

M4 目录扫描导入（core 的 `scanDirectory` 已写好并测过，缺 API 与界面）→ M5 错误归因打磨与
Windows 兼容验证。

## 踩过的坑

- `better-sqlite3` 需要跑安装脚本。pnpm 10+ 默认拦截，已在 `pnpm-workspace.yaml` 的
  `onlyBuiltDependencies` 里放行；换机器后报 `ERR_PNPM_IGNORED_BUILDS` 就跑 `pnpm approve-builds --all`。
- pnpm 12 偶尔会把 `node_modules/.pnpm/` 里的软链指到不存在的目录，表现为某个包的
  `node_modules/.bin` 里少了命令。`pnpm dedupe` 能修好。
- `pullRepo` 的前置检查只用本地事实（不是仓库 / 空仓库 / 脏 / detached），
  **不拿旧的 ahead/behind 去判「没东西可拉」**——那个数字来自上次 fetch，会把真有更新的仓库
  误报成「已是最新」。拉取交给 `pull --ff-only` 自己 fetch，失败后再用新 refs 判分叉。
- 停后台服务要按端口找 PID 再杀：`netstat -ano | grep :5174`。**别用 `taskkill /IM node.exe`**，
  会把跑着 agent 的 node 一起杀掉。
- `Scheduler.schedule` 不会重入：不要在已排队的任务里再对同一个仓库 key 调 `schedule`，
  会自锁。core 的 `getRepoStatus` / `analyzeUpdates` / `pullRepo` 内部都自己排队，调用方
  直接 `Promise.all` 就行，限流交给它们。
