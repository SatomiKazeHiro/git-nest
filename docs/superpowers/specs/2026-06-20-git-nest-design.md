# git-nest 设计文档

> 个人 git 项目管理工具：管理自己的项目 + 追踪/备份网上开源项目的本地克隆。
> 核心价值：项目表 CRUD + 更新分析（用户勾选，不自动）+ 备注/tag 元数据，未来接入 Agent 协助管理。

- 日期：2026-06-20
- 状态：待用户审阅
- 部署形态：本地运行，Node 后端 + React 前端，浏览器访问

## 1. 背景与目标

用户目前用一份手写 README.md 维护项目清单（五个分区：personal / knowledge-base / backups / experiments / tools），痛点：

- 无法直观看到每个仓库的状态（分支、是否落后远程、最后更新时间）
- 追踪类项目（backups/tools/experiments）的更新靠手动逐个检查
- 备注、来源链接（多为 B 站视频）、分类都混在 Markdown 里，不可检索

**目标**：一个本地 web 应用，替代手写 README，提供项目清单管理、git 状态可视化（含 git-graph）、批量更新检测与勾选式更新。

**非目标（YAGNI）**：

- 不做 git 客户端（不替代提交/合并/rebase 等操作，详情页只读 + 跳转）
- 不做多用户、不做云端同步、不做移动端
- 本期不写 Agent 代码，只做接口预留
- 不自动更新任何仓库——更新永远由用户勾选触发

## 2. 总体架构

```
git-nest/
├── apps/
│   ├── server/   Fastify + better-sqlite3，REST + SSE（批量操作进度推送）
│   └── web/      Vite + React 19 + TanStack Query + React Router
└── packages/
    └── core/     共享 TS 类型 + git 命令封装 + git 输出解析器
```

- 包管理：pnpm workspace
- 数据流：`web → HTTP → server → core/git 层 → 本地仓库`
- **元数据存 SQLite；git 实时状态不落库**，每次请求现查（短缓存几秒即可），避免状态腐化
- `packages/core` 无 UI、无 HTTP 依赖，是纯函数式 git 能力层——server 现在用，未来 Agent 模块也用

### 技术选型理由

- **Fastify 而非 Next.js**：长时 git 子进程 + SSE 进度推送在独立后端里更干净；REST API 是未来 Agent 接入的天然接口
- **better-sqlite3**：同步 API、零配置、单文件库，适合几十到几百项目的量级
- **git CLI（child_process）而非 isomorphic-git**：行为与用户在终端里完全一致，github-kb 的安全规则可直接复用
- **react-git-log（`@tomplum/react-git-log`）作为可插拔弱依赖**：要求 React 19，单人小项目，若不可用则自研简单泳道图组件替换，接口隔离在详情页单个组件内

## 3. 数据模型（SQLite）

```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,          -- 本地绝对路径，仅存本地 DB，不外泄
  remote_url  TEXT,                          -- origin URL，可为空（纯本地项目）
  category    TEXT NOT NULL DEFAULT '',      -- 自由字符串，初始值见下
  source_url  TEXT,                          -- 来源链接（如 B 站视频）
  summary     TEXT,                          -- 一句话摘要（README 首段）
  added_at    TEXT NOT NULL,                 -- ISO 时间
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE project_tags (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE update_checks (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checked_at   TEXT NOT NULL,
  status       TEXT NOT NULL,   -- up_to_date | behind | ahead | diverged |
                                -- dirty | no_upstream | detached | no_remote | error
  ahead_count  INTEGER,
  behind_count INTEGER,
  detail       TEXT             -- JSON：错误信息或附加说明
);
```

设计要点：

- **category 是自由字符串**，不做枚举表；初始值 personal / knowledge-base / backups / experiments / tools，用户可改可加
- **notes 一对多**，支持多条备注，带时间戳
- **update_checks 保留历史**，支撑"最后检查时间"展示和未来趋势分析
- `path` 只存本地 SQLite（不进入任何会被提交/分享的文件），遵循 github-kb 的路径隐私规则

## 4. Git 执行层（packages/core）

所有 git 调用走 `node:child_process`，硬规则（照抄 github-kb，实测有效）：

1. 所有命令设 `GIT_TERMINAL_PROMPT=0` + `git -c credential.interactive=false`，防止凭证交互挂死；单命令硬超时（默认 120s，可配置）
2. **同一仓库的操作串行**（per-repo 队列），跨仓库并发上限 4（可配置），防锁冲突和 host 限流
3. **pull 只允许 `--ff-only`**；禁止 `reset --hard` / `clean` / `push` / 任何历史重写
4. 探测命令逐个执行、单独判退出码（「没有上游」「detached HEAD」是预期内的非零退出，不是失败）
5. 仓库标识、路径一律加引号拼命令，防注入

对外 API（纯函数风格，返回结构化结果，不抛裸错误）：

```ts
// 仓库实时状态：分支、dirty、ahead/behind、最后 commit 时间
getRepoStatus(path: string): Promise<RepoStatus>

// fetch（只动 refs/remotes/*，不碰工作区）后分析：
// 状态 + ahead/behind 数 + 新增 commit 列表 + 新 tag 列表
analyzeUpdates(path: string): Promise<UpdateReport>

// 仅 --ff-only；前置检查（dirty / detached / no_upstream）不过则拒绝并给原因
pullRepo(path: string): Promise<PullResult>

// 供 react-git-log 的 GitLogEntry[]：
// git log --all --pretty=format:'hash:%H,parents:%P,branch:%S,msg:%s,cdate:%cd,adate:%ad,author:%an,email:%ae' --date=iso
getLog(path: string, opts?: { maxCount?: number }): Promise<GitLogEntry[]>

// 扫描一层子目录发现 git 仓库（.git 目录或文件都算，兼容 worktree/submodule）
// 返回：目录名、remote origin URL、README 首段摘要
scanDirectory(dir: string): Promise<ScannedRepo[]>
```

状态机必须覆盖的常态分支（不是异常，是正常状态）：`no_upstream`、`detached`、`gone`（远程分支已删）、`no_remote`。

## 5. 更新分析流程（核心交互）

**原则：绝不自动更新。** 检测可以批量跑，更新必须用户勾选。

```
列表页点「检查更新」
  → 后端并发（上限 4）对每个仓库执行 analyzeUpdates
  → 逐仓库产出 UpdateReport：
      status / behind N / 新增 commit 列表（hash + message + 日期）/ 新 tag
  → 写入 update_checks 历史
→ 前端分析面板逐仓库展示报告，用户勾选要更新的
→ POST /api/projects/update { ids: [...] }
  → 被选仓库逐个串行 pull --ff-only，SSE 推送每仓库进度
  → dirty / detached / no_upstream 的直接跳过并标记原因
→ 结果汇总表：已更新 N 提交 / 已是最新 / 跳过（原因） / 失败（原因）
```

- 分类为 `personal` 的项目默认不参与批量更新检测（自己的项目自己清楚），设置里可开
- 批量操作仓库数 > 20 时先让用户确认范围（沿用 github-kb 惯例）

## 6. HTTP API（apps/server）

```
GET    /api/projects?category=&tag=&q=     项目列表（含最新一次 update_check 摘要）
POST   /api/projects                       手动添加本地路径；或给远程 URL + 目标目录，后端先 clone 再入库
PATCH  /api/projects/:id                   改名/分类/来源链接/摘要/排序
DELETE /api/projects/:id                   移除管理（只删 DB 记录，绝不动磁盘仓库）

GET    /api/projects/:id/status            实时 git 状态（getRepoStatus）
GET    /api/projects/:id/log?max=          commit 图数据（getLog）
GET    /api/projects/:id/notes             备注列表
POST   /api/projects/:id/notes             新增备注
PATCH  /api/notes/:id                      改备注
DELETE /api/notes/:id                      删备注

GET    /api/tags                           tag 列表
POST   /api/tags                           新建 tag
PUT    /api/projects/:id/tags              设置项目的 tag 集合（整体替换）

POST   /api/scan                           { dir } → 扫描预览（不入库）
POST   /api/projects/import                { paths: [...] } → 勾选项批量入库

POST   /api/updates/check                  { ids?: [...] } → 批量 fetch+分析（SSE 进度）
POST   /api/updates/apply                  { ids: [...] } → 勾选仓库 pull --ff-only（SSE 进度）
```

## 7. 前端页面（3 个视图）

### 7.1 项目列表（主页）

- 按分类分组的表格，列：名称 / 当前分支 / ahead↑behind↓ / 脏标记 / 最后 commit 时间 / 最后检查时间 / tags
- 过滤：分类、tag、关键字；行内多选（配合批量检查更新）
- 顶栏：「检查更新」「添加项目」「扫描目录」

### 7.2 项目详情

- git-graph（react-git-log，HTML Grid 变体；封装在独立组件内，可替换）
- 更新分析报告区（最新一次 check 的 commit 列表与新 tag）
- 备注列表（增删改，多条）
- tag 管理、分类、来源链接、摘要编辑
- 「检查更新」「更新到此仓库」按钮（单仓库版流程）

### 7.3 设置

- 扫描目录管理：添加目录 → 扫描预览（列出发现的仓库 + remote + 摘要）→ 勾选入库 / 移除管理
- 参数：git 超时、并发上限、personal 是否参与批量检测

## 8. 错误处理

- git 命令失败按类归因：网络 / 认证 / 锁文件残留 / 非仓库路径，各自给可操作的提示（如提示用户手动删 `index.lock`）
- 凭证问题：不代用户输入密码/token，提示用户在终端自行认证（私有仓库建议 `gh auth login`）
- 仓库被外部移动/删除：status 探测失败 → 标记 `missing`，UI 置灰，不自动移除
- 所有批量操作部分失败不影响其他仓库，结果按四类汇总

## 9. 测试策略

- `packages/core`：vitest 单测。git 层用临时目录真实初始化仓库做集成测试（init → commit → clone → 制造 behind/dirty/detached 各状态），不 mock git
- `apps/server`：API 层用 Fastify inject 测试，core 层 mock
- `apps/web`：组件测试从简，核心交互（勾选更新流程）用 MSW mock API 测一条 happy path
- Windows 兼容验证在 M5 手动进行（路径、凭证弹窗、长路径）

## 10. Agent 预留（本期不实现）

- `packages/core` 无 UI/HTTP 依赖 → Agent 可直接 import 或调 REST API
- API 覆盖全部用户操作 → Agent 能力 = 用户能力，无特权后门
- `update_checks` / `notes` / `tags` 的历史数据都在 SQLite → 供 Agent 做"哪些项目值得关注"的分析
- 未来形态预想：一个 Agent 模块读取 API + 向用户提建议（"X 仓库 3 个月没更新且你有备注说要用它"），执行仍走勾选确认

## 11. 推进计划

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1 骨架 | pnpm monorepo、SQLite schema、项目 CRUD API、列表页（无 git 状态） | 手动添加/编辑/移除项目，列表渲染 |
| M2 git 状态 | core git 层 + 状态列 + 详情页 git-graph | 真实仓库的状态/图正确展示 |
| M3 更新模块 | 批量检查 → 分析报告 → 勾选 → ff-only 更新 + SSE 进度 | 构造 behind 仓库完成全流程 |
| M4 元数据 | 备注、tag、来源链接、目录扫描导入/移除 | 扫描一个目录入库并完整编辑元数据 |
| M5 打磨 | 错误归因、空态、Windows 兼容验证 | 断网/脏工作区/detached 场景提示正确 |

每个里程碑结束跑通该里程碑验收再进下一个；M3 是核心价值所在，优先级最高。

## 12. 参考

- github-kb 安全规则与 git 命令惯例：`.reference/github-kb/SKILL.md`（本设计第 4 节全部沿用）
- react-git-log：https://github.com/TomPlum/react-git-log（npm 包名 `@tomplum/react-git-log`，要求 React 19，用 HTML Grid 渲染器）
- 同类产品交互参考：RepoZ（分组大列表 + 状态符号列）、gita（状态机颜色编码）、mani（清单即代码）

## 13. 实现与本文档的差异

本文档写于 M1 之前，实现过程中有若干处偏离。逐条记在这里，附原因，
免得下次核对时又要重新考古。

**接口与流程**

1. 更新用的是 `POST /api/updates/apply`，不是第 6 节的 `POST /api/projects/update`。
   理由：check 与 apply 归到同一个前缀下更清楚，也避免 `/api/projects/update` 被
   误读成「更新项目记录」。
2. 批量任务用「POST 启动拿 taskId + GET `/api/updates/:taskId/events` 订阅 SSE」，
   而不是第 6 节的「POST 直接开 SSE」。理由：**EventSource 只能发 GET**，
   POST + SSE 在浏览器里做不到。第 5 节的流程本身没变。
3. 额外加了几个文档没写的接口：`GET /api/status?ids=`（列表页一次拿全状态）、
   `GET/PATCH /api/settings`、以及 `PATCH /api/projects/:id` 支持改 `path`
   （仓库被移走后重新指路；`path` 仍然是唯一的）。

**git 执行层**

4. 用 `execFile` + argv 传参，而不是第 4 节写的「路径一律加引号拼命令」——
   目的相同（防注入）但更彻底：不经过 shell 就没有引号绕过这回事。
5. 仓库目录用 `git -C <dir>`，而不是把目录设成子进程的 `cwd`。
   理由：cwd 走的是 OS 的 `SetCurrentDirectory`，Windows 上路径超过约 260 字符时
   会直接 spawn 失败。实测踩过。
6. 每条 git 命令额外带 `-c credential.helper=`。只设 `GIT_TERMINAL_PROMPT=0`
   **挡不住** git 卡在凭证链上（实测挂 8 秒以上无输出），一个私有仓库就能把
   整批检查拖到超时。

**界面**

7. 提交图没有用 react-git-log，是自研的泳道图（第 4 节允许「可插拔弱依赖，
   不可用则自研替换」）。接口隔离在 `apps/web/src/features/gitgraph/`，
   将来换库只改那一个组件。
8. 第 7.2 节的「更新分析报告区」做成了按需展开（点「检查更新」才出现），
   而不是常驻区域。理由：不检查就没有「最新一次报告」可言，常驻一个空区块
   反而在骗人。
9. 更新结果汇总是一行文字，不是第 5 节说的「表」。逐仓库的结论在上面的行里
   已经逐条列出了，汇总只做计数。

**文档没考虑到、后来发现必须处理的**

10. **状态措辞要按新鲜度降级。** 状态接口只读本地 refs（上次 fetch 之后的事实），
    从不联网，所以「已是最新」在没有依据时是失真的。实测用户报过：远程更新了
    上千个提交，页面上还是「已是最新」。现在远程相关的结论要看新鲜度：
    从没查过显示「没查过远程」且不给颜色，查过但超过 12 小时把「已是最新」
    降级成「上次看是最新」；纯本地状态（脏 / 游离 / 没有远程）不受影响。
