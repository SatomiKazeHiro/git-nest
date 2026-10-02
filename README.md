# git-nest

本地 git 项目管理工具：管理自己的项目 + 追踪网上开源项目的本地克隆。
替代手写 README 项目清单——项目表、备注/tag 元数据、批量更新检测与勾选式更新。

> **接手先看 [`docs/STATUS.md`](docs/STATUS.md)**：当前进度、代码地图、核心不变量、
> 待决定的事、以及这个环境踩过的坑。
> 设计与实现差异见 [`docs/superpowers/specs/2026-06-20-git-nest-design.md`](docs/superpowers/specs/2026-06-20-git-nest-design.md) 第 13 节。

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
│   ├── server/   Fastify + better-sqlite3，REST + SSE（批量更新的进度就是 SSE）
│   └── web/      Vite + React 19 + TanStack Query + React Router + Tailwind v4
└── packages/
    └── core/     共享类型 + zod 校验 + git 执行层，前后端同一份
```

- `packages/core` 无 UI、无 HTTP 依赖，以源码形式被引用（`exports: ./src/index.ts`），改完不用构建。
- **core 有两个入口**（`package.json` 的 `exports` 里还有一个 `./types`，当前无人引用）：
  `@git-nest/core`（类型 + zod，浏览器安全）与 `@git-nest/core/git`
  （依赖 `node:child_process`，只能 node 侧引）。别在 barrel 里 `export *` git 层，
  否则浏览器打包会报 `node:child_process has been externalized`。
- 元数据进 SQLite；git 实时状态不落库，每次现查（server 侧 3 秒短缓存，`?fresh=true` 可绕开）。
- 本地绝对路径只存在本机 SQLite 里，不进任何会被提交的文件。

## 前端技术栈怎么用

| 库 | 用途 |
|---|---|
| TanStack Query | 所有服务端状态：清单、详情、标签、批量 git 状态 |
| Zustand | 纯 UI 状态：筛选条件、行选中、编辑弹窗 |
| Zod | 前后端共用同一份 schema（`packages/core/src/schemas.ts`），前端提交前先校验，错误逐字段显示 |
| ahooks | `useDebounce` 搜索防抖 |
| es-toolkit | `groupBy` 按分类分组、`orderBy` 分类/标签/备注排序 |
| React Router | 三个视图：清单 `/`、详情 `/projects/:id`、设置 `/settings` |
| Tailwind v4 | 设计 token 定义在 `apps/web/src/index.css` 的 `@theme` 里 |
| msw + testing-library | 勾选更新流程的组件级测试（设计文档第 9 节要求） |

## git 执行层的硬规则

全部实现在 `packages/core/src/git/`，照抄 `.reference/github-kb` 的安全规则：

1. 每次调用都带 `GIT_TERMINAL_PROMPT=0` + `credential.interactive=false` + `credential.helper=`，
   单命令硬超时（默认 120s，在设置页改；见下面「超时怎么调」）
2. 用 `execFile` + argv 传参，不走 shell；仓库目录用 `git -C <dir>` 而不是 spawn 的 cwd
   （cwd 走 OS 的 SetCurrentDirectory，路径过长会直接 spawn 失败）
3. **同仓库串行、跨仓库并发上限 4**（`Scheduler`），防 `index.lock` 冲突与远程限流
4. 探测命令逐个执行、单独判退出码：「没有上游」「detached HEAD」是预期内的非零退出
5. `pull` 只允许 `--ff-only`；脏工作区 / detached / 无上游 / 已分叉一律跳过并说清原因
6. 失败按 网络 / 认证 / 锁残留 / 路径过长 / 目录丢失 归因，各自给可操作的提示；
   「远程仓库找不到」单独说，不当成「要认证」——那会把人引向错误的方向

状态机覆盖的常态分支（不是异常）：`up_to_date` `behind` `ahead` `diverged` `dirty`
`no_upstream` `gone` `detached` `no_remote` `no_commits` `missing` `not_a_repo`，
外加一个 `error`（读不出来，比如路径过长或 git 起不来）。完整定义见
`packages/core/src/git/types.ts` 的 `UpdateStatus`。

**状态措辞按新鲜度降级。** 状态接口只读本地 refs、从不联网，所以「已是最新」在
没有依据时是失真的：远程相关的结论（最新/落后/领先/分叉）要看「什么时候查过」——
从没查过时 `up_to_date` 退成「没查过远程」且不给颜色；但 `behind`/`ahead`/`diverged`
的**方向和数字照常显示**（它们来自本地 refs，本身可靠），只标注「本地看到的，没联网确认」。
超过 12 小时把「已是最新」降级成「上次看是最新」。纯本地状态（脏 / 游离 / 没有远程）
任何时候都可信，不受影响。

## 自动 fetch 与命令日志

服务启动 30 秒后自动跑一轮 fetch，之后每 30 分钟一轮。它让「落后多少 / 推不推荐更新」
的数字保持新鲜——否则新加的仓库在你手动检查前推荐列一直是空的。

**它只更新 `refs/remotes/*`：不 pull、不快进、不碰工作区**，「绝不自动更新」那条不变量
仍然成立。personal 分类默认跳过（跟设置页那个开关走）。

**每一条 git 命令都记进命令日志**（设置页 →「自动 fetch 与命令日志」→ 看命令日志，
或 `GET /api/commands`）：时间、发起者（`auto-fetch` / `check` / `status` / `pull`）、
完整实参、仓库目录、退出码、耗时。日志在内存里，最近 1000 条，重启清空——
它是排查工具，不是审计系统。

## 推不推荐更新（一阶段最要紧的一条）

清单页有「推荐」一列，详情页有完整理由。它回答的不是「落后几个」，而是
**拉了会不会出事**——尤其是用户点名要防的「作者删库 / 重置仓库」：

| 判决 | 什么情况 | 显示 |
|---|---|---|
| `safe` | 本地 HEAD 是上游的祖先 | 可更新（能快进） |
| `diverged` | 两边都有提交，但有共同祖先 | 要你决定 |
| `rewritten` | 上次见到的上游提交**不再**在上游历史里 | **别拉**（作者 force push 了） |
| `unrelated` | 两个历史**没有共同祖先** | **别拉**（作者多半删库重建了） |

判据是 `git merge-base --is-ancestor` 的退出码（0=是祖先 / 1=不是 / 其它=出错），
实现在 `packages/core/src/git/inspect/recommend.ts`，行为表在
`packages/core/test/git/recommend.test.ts`（9 个真实仓库场景）。

**一个诚实的限制**：作者 force push 掉「本地从没读到过」的提交，是**看不出来**的
——那种情况本地 HEAD 仍是新历史的祖先，git 自己也会正常快进。要抓住它只能靠基线
（上次见到的上游 SHA），而基线需要检查过一次才有。这个限制有一条专门的用例钉着。

结论**只在真正检查过之后才产生**，并随检查结果落库（`update_checks.detail`）；
清单页显示的是那次结论，不是现算的——现算要先 fetch，而列表是纯本地读。
没查过就显示「没查过」，绝不给绿色的「可更新」。

## API

方法逐条写清（别写成 `GET/POST/PUT/DELETE /api/tags` 那种——实际每个路径支持的方法
并不一样，照着写客户端会 404）。`apps/server/test/docs-api-drift.test.ts` 会拿这段
和源码里真实注册的路由对账，写错了测试就红。

```
GET    /api/health

GET    /api/projects?category=&tag=&q=
POST   /api/projects               路径必须是已存在的目录；不填 remoteUrl 时从 git 的 origin 自动填
GET    /api/projects/:id           单个项目（含标签、备注、最近一次检查）
PATCH  /api/projects/:id           部分更新：只提交的字段会被改（可改 path 重新指路）
DELETE /api/projects/:id           只删 DB 记录，绝不动磁盘仓库

GET    /api/projects/:id/status    实时 git 状态（?fresh=true 绕开服务端 3 秒短缓存）
GET    /api/projects/:id/log?max=  当前检出分支的提交记录（一阶段界面不显示，留给二阶段 Agent；max 上限 1000，默认 200）
GET    /api/status?ids=1,2,3       批量状态，列表页一次拿全（一次最多 200 个）

PUT    /api/projects/:id/tags      整体替换项目的标签集合（不存在的标签名按需创建）
GET    /api/projects/:id/notes     备注列表
POST   /api/projects/:id/notes     加一条备注
PATCH  /api/notes/:id             改备注内容
DELETE /api/notes/:id             删备注
GET    /api/tags                  标签列表（带每个标签的项目数）
POST   /api/tags                  建标签（名字唯一、最长 40 字）
DELETE /api/tags/:id              删标签（注意要带 :id；没有对集合的 DELETE）

POST   /api/scan                   扫一层子目录预览（只读；remember=true 记进常用目录；depth 1–3）
POST   /api/projects/import        把扫出来的目录入库（一个事务：要么全进、要么全不进）
GET    /api/settings               读设置
PATCH  /api/settings              改设置（personal 是否参与检查、git 超时、并发、确认阈值、常用目录）

GET    /api/commands              最近执行过的 git 命令（?limit=，默认 100 上限 1000，新的在前）
DELETE /api/commands              清空命令日志（内存里的事，重启也会清）
POST   /api/auto-fetch            手动跑一轮自动 fetch（定时器最快也要等 30 秒）

POST   /api/updates/check         批量 fetch+分析，202 返回 taskId（ids 省略 = 全部非 personal）
GET    /api/updates/:taskId       任务快照
GET    /api/updates/:taskId/events  进度 SSE（?cursor= 可取历史事件；服务端会重放缓冲）
POST   /api/updates/apply         对勾选的仓库逐个 pull --ff-only，同样 202 + SSE
```

**超时怎么调**：没有 `GIT_NEST_GIT_TIMEOUT` 这个环境变量——超时是设置表里的
`gitTimeoutMs`（默认 120s，允许 1s–600s），在设置页改，或 `PATCH /api/settings`。
代码真正读的环境变量只有这几个：

| 变量 | 用途 | 默认 |
|---|---|---|
| `GIT_NEST_DB` | SQLite 文件位置 | `data/git-nest.db` |
| `GIT_NEST_PORT` | server 端口 | `5174` |
| `GIT_NEST_HOST` | server 监听地址 | `127.0.0.1` |
| `GIT_NEST_CORS` | 允许的跨域来源 | `http://localhost:5173` |
| `GIT_NEST_API` | web 开发服务器的 API 代理目标 | `http://127.0.0.1:5174` |

更新任务为什么是「POST 启动 + GET 订阅」：`EventSource` 只能发 GET，而批量检查可能要联网
fetch 十几个仓库，不能让一个 HTTP 请求一直挂着。任务状态放内存（半小时 TTL，**只清已结束的任务**），
进度事件用「缓冲数组 + 游标」而不是发布订阅——前端拿到 id 再开连接是常态，缓冲保证不丢事件。

## 已完成

**M1 骨架** — 项目 CRUD、分类/标签/备注元数据、清单页与详情页、标签设置页。
请求体验证统一走 zod，失败返回 422 + 逐字段说明。

**M2 git 状态** — `packages/core` 的 git 执行层（status / log / pull / scan / scheduler /
错误归因）、清单页状态列、详情页 git 状态摘要。
（提交图曾用 `@tomplum/react-git-log`，**一阶段已从界面撤掉**：它是个不虚拟化的 HTML
网格，为 120 条提交就渲染出成百上千个节点。`GET /api/projects/:id/log` 这个接口留着，
二阶段 Agent 解析仓库要用；留着不等于要显示。）

**M3 更新模块** — 批量检查更新 → 逐仓库分析报告（新增 commit / 新 tag / ahead-behind）→
勾选 → ff-only 更新 → 结果汇总，全程 SSE 推进度。设置页可调 personal 是否参与检查、
git 超时、并发上限、确认阈值。**核心原则：绝不自动更新**，检查只是给建议，
真正动工作区的只有用户勾选后点的那一次。

**M4 目录扫描导入** — 设置页的扫描区：输目录（常用目录会记下来）→ 扫描预览
（仓库名 / 远程 / 摘要，标出哪些已在清单）→ 勾选 → 入库。扫描只读，不写库不动磁盘；
入库只插 DB，名字取目录名、远程地址从 git 读，摘要与分类留给用户补。
超过「确认阈值」个时会先问一遍范围。

**M5 异常与 Windows 验证** — 错误归因落到每一类都带可操作的提示；目录没了不自动移除，
而是置灰 + 引导改路径（`PATCH` 支持改 path，校验存在与撞车）；详情页 / 提交图把
「目录不在了」和「不是仓库」区分开说。

测试 141 个用例：git 层全部用临时目录里**真实 git 仓库**跑（init → commit → clone →
构造 behind / ahead / diverged / dirty / detached 各状态），不 mock git；
M5 另有一个只回 401 的本地假远程，用来验证凭证场景既不弹窗也不挂死；
web 层按设计文档第 9 节用 MSW 测了勾选更新流程的组件级 happy path。

## 还没做

五个里程碑都完成了。设计文档第 13 节记了实现与文档的**全部差异**（17 条，其中
2026-10 审计时补记了原来漏掉的 7 条），包括为什么 `credential.helper=` 不能少、
为什么用 `-C` 而不是 cwd。质量审计的完整结论在 [`docs/AUDIT-2026-10-01.md`](docs/AUDIT-2026-10-01.md)。

往后的方向：

- **Agent 接入**（设计文档第 10 节）：`packages/core` 无 UI/HTTP 依赖、API 覆盖全部用户操作，
  Agent 的能力上限 = 用户的能力上限，没有特权后门。可以先做「哪些项目值得关注」这类分析。
- `update_checks` 的历史趋势利用（现在只存不用）

## 踩过的坑

- **`-c credential.helper=` 是必须的。** 只设 `GIT_TERMINAL_PROMPT=0` 不够：遇到要密码的
  远程时 git 会卡在凭证链上（实测挂 8 秒以上无任何输出），一个私有仓库就能把整个批量检查
  拖到超时。清空 helper 之后它立即报 `unable to get password from user`。
- **长路径**：实测 258 字符的目录**存在**，但 `git -C <它>` 直接 `fatal: cannot change to
  ...: No such file or directory`（exit 128），带 `core.longpaths=true` 也一样 ——
  那个选项救不了最初的 chdir。这类仓库现在直接报 `path_too_long`（门槛取 240 字符，
  比 MAX_PATH 约 260 保守一截）并说清怎么办，而不是含糊地说「不是 git 仓库」。
- `better-sqlite3` 需要跑安装脚本。pnpm 10+ 默认拦截，已在 `pnpm-workspace.yaml` 的
  `allowBuilds` 里放行（**pnpm 12 的键名是 `allowBuilds`**；pnpm 10/11 时代叫
  `onlyBuiltDependencies`，旧键在 12 里已被合并、写了不生效）；换机器后报
  `ERR_PNPM_IGNORED_BUILDS` 就跑 `pnpm approve-builds --all`。
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
