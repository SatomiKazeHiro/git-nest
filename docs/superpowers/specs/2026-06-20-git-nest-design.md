# git-nest 设计文档

> 个人 git 项目管理工具：管理自己的项目 + 追踪/备份网上开源项目的本地克隆。
> 核心价值：项目表 CRUD + 更新分析（用户勾选，不自动）+ 每个项目一段自己的记录 + tag 元数据，未来接入 Agent 协助管理。

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
- **git CLI 与 isomorphic-git 分工，而不是二选一**：一开始是「只用 git CLI」，理由是行为与终端逐字节一致、安全规则可直接复用——这条对**工作区与写操作**仍然成立，所以 `status --porcelain`（脏标记）、`rev-list`（ahead/behind）、`fetch` / `pull --ff-only` 继续走 CLI。但**只读 ref/config**（分支名、HEAD、上游配置、origin 地址）不需要 git 的语义，只是读 `.git` 下几个小文件；在 Windows 上为此起一次 git.exe 要约 70ms（20ms 是 CreateProcess 的地板），列表页十几个仓库就是好几秒。这部分交给 isomorphic-git（纯 JS，MIT），每仓库省 2 次进程启动，实测列表页 612ms → 198ms。**分界线的判据是「需不需要与 git 逐字节一致」，不是「谁快」**——脏标记是 `pull` 的安全闸，就必须与 git 一致；分支名没有这种要求。
- **react-git-log（`@tomplum/react-git-log`）作为可插拔弱依赖**：要求 React 19，单人小项目，若不可用则自研简单泳道图组件替换，接口隔离在详情页单个组件内

## 3. 数据模型（SQLite）

```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,          -- 本地绝对路径，仅存本地 DB，不外泄
  remote_url  TEXT,                          -- origin URL，可为空（纯本地项目）
  category    TEXT NOT NULL DEFAULT '',      -- 自由字符串，初始值见下
  record      TEXT NOT NULL DEFAULT '',      -- ★ 你自己写的那段（迁移 004 加的，见 §13 第 19 条）
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

CREATE TABLE update_checks (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checked_at   TEXT NOT NULL,
  status       TEXT NOT NULL,   -- 取值是完整的 UpdateStatus（见 packages/core/src/git/types.ts）：
                                -- up_to_date | behind | ahead | diverged | dirty |
                                -- no_upstream | gone | detached | no_remote |
                                -- no_commits | missing | not_a_repo | error
                                -- 注意 recordUpdateCheck 会写入任意一种，不只是远程相关的那几个
  ahead_count  INTEGER,
  behind_count INTEGER,
  detail       TEXT             -- JSON：错误信息或附加说明
);
```

> **原设计里的 `source_url` / `summary` 两列与 `notes` 表已删**（迁移 004）：三样都被
> `projects.record` 一个字段替代。为什么撤，见第 13 节第 19 条。

设计要点：

- **category 是自由字符串**，不做枚举表；初始值 personal / knowledge-base / backups / experiments / tools，用户可改可加
- **记录是一个字段，不是一张表**：怎么找到这个项目的、有什么想法，链接写在正文里。
  原设计的「notes 一对多 + 来源链接 + 摘要」已撤（§13 第 19 条）
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

> **这张表是设计时的设想，不是现状。** 实际注册的路由以
> `apps/server/src/routes/` 为准，完整清单在 `README.md` 的 API 段
> （`apps/server/test/docs-api-drift.test.ts` 会对账，防止文档再飘）。
> 与下面的差异逐条记在第 13 节。

```
GET    /api/projects?category=&tag=&q=     项目列表（含最新一次 update_check 摘要）
POST   /api/projects                       手动添加本地路径；或给远程 URL + 目标目录，后端先 clone 再添加
PATCH  /api/projects/:id                   改名/分类/记录/排序
DELETE /api/projects/:id                   移除管理（只删 DB 记录，绝不动磁盘仓库）

GET    /api/projects/:id/status            实时 git 状态（getRepoStatus）
GET    /api/projects/:id/log?max=          commit 图数据（getLog）

GET    /api/tags                           tag 列表
POST   /api/tags                           新建 tag
PUT    /api/projects/:id/tags              设置项目的 tag 集合（整体替换）

POST   /api/scan                           { dir } → 扫描预览（不写库）
POST   /api/projects/import                { paths: [...] } → 勾选项批量添加进清单

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
- **记录**：在「编辑资料」弹窗里写（那个弹窗是**唯一的编辑器**，标签也在里面）；
  详情页只**只读展示**它，正文里的链接可点。不放在页面上直接编辑，是因为那会造成
  「记录在外面、别的字段在弹窗里」这种说不清的边界（用户原话：「这和顶部的编辑资料
  不有歧义吗」）。同样地，标签行旁边那个「改标签」快捷入口也删了：指向同一个弹窗的
  第二个门同样是重复。展示位置：**身份信息那张 `<dl>` 里的一行**（排在标签之后），
  不单独占一个分区标题——它在库里就是 `projects` 表上的一列，和 路径 / 分类 / 标签
  同级（原来是「git 状态」旁边的 `<h2>`，沿用了旧「备注」列表的位置）。
- 身份信息与 tag：走「编辑资料」弹窗（tag 只有那一个编辑器）
- 「检查更新」「更新到此仓库」按钮（单仓库版流程）

### 7.3 设置

- 扫描目录管理：添加目录 → 扫描预览（列出发现的仓库 + remote + 摘要）→ 勾选添加 / 移除管理
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
- `update_checks` / `tags` 的历史数据 + 每个项目的 `record` 都在 SQLite → 供 Agent 做"哪些项目值得关注"的分析
- 未来形态预想：一个 Agent 模块读取 API + 向用户提建议（"X 仓库 3 个月没更新且你写的记录里说要拿它做东西"），执行仍走勾选确认

## 11. 推进计划

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1 骨架 | pnpm monorepo、SQLite schema、项目 CRUD API、列表页（无 git 状态） | 手动添加/编辑/移除项目，列表渲染 |
| M2 git 状态 | core git 层 + 状态列 + 详情页 git-graph | 真实仓库的状态/图正确展示 |
| M3 更新模块 | 批量检查 → 分析报告 → 勾选 → ff-only 更新 + SSE 进度 | 构造 behind 仓库完成全流程 |
| M4 元数据 | 记录、tag、目录扫描导入/移除 | 扫描一个目录添加进清单并写下第一条记录 |
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

7. 提交图最终**用了** `@tomplum/react-git-log`（第 4 节指定的那个弱依赖）。
   中间走过一段弯路：M2 先自研了一版泳道图（当时记为「不可用则自研替换」），
   但自研的列分配有车道泄漏——只在「提交的父都已落位」时释放列，而「基点不是
   root 的 merge」会让第二个父提交预定过的列从此无人释放，列数随 merge 数量单调
   膨胀；真实仓库 archify（120 提交、19 个 merge）算出 40 条列（其中 8 条无人引用），
   再被宽度上限一夹，75/120 个提交点被画到画布外。
   后来换回库：`apps/web/src/features/gitgraph/` 下两个文件，职责按「是否与库绑定」分：
   - `queries.ts` —— 取数，**与渲染库无关**（换后端接口时才动）
   - `GitGraph.tsx` —— 字段映射 + `<GitLog>` 用法，**与库绑定的唯一一处**，
     换渲染方式只动它
   自研的 `layout.ts` 与其测试已删除。
   附带一处语义调整：`getLog` 默认只取当前检出分支（不再 `--all`），
   因为库按 `branch` 组织图，混入别的分支会让提交的分支归属说不清。
8. 第 7.2 节的「更新分析报告区」做成了按需展开（点「检查更新」才出现），
   而不是常驻区域。理由：不检查就没有「最新一次报告」可言，常驻一个空区块
   反而在骗人。
9. 更新结果汇总是一行文字，不是第 5 节说的「表」。逐仓库的结论在上面的行里
   已经逐条列出了，汇总只做计数。

**文档没考虑到、后来发现必须处理的**

10. **状态措辞要按新鲜度降级。** 状态接口只读本地 refs（上次 fetch 之后的事实），
    从不联网，所以「已是最新」在没有依据时是失真的。实测用户报过：远程更新了
    上千个提交，页面上还是「已是最新」。现在远程相关的结论要看新鲜度：
    「已是最新」在没有依据时退成「没查过远程」且不给颜色，查过但超过 12 小时
    降级成「上次看是最新」；纯本地状态（脏 / 游离 / 没有远程）不受影响。
    后续修正（用户报「一边说落后 2411 个提交、一边说没查过远程」）：**限定词附加
    在真实状态上，不替换它** —— `behind`/`ahead`/`diverged` 的方向和数字来自本地
    refs、本身可靠，照常显示，只标注「本地看到的，没联网确认」。

**2026-10 审计时补记的差异**（原来漏在本文档之外，见 `docs/AUDIT-2026-10-01.md`）

11. 第 6 节的 `POST /api/projects` 支持「给远程 URL + 目标目录，后端先 clone 再添加」
    **没有实现**：只接受已存在的本地目录，远程地址是从 `git remote` 读出来自动填的。
    clone 这种事交给用户自己在终端做，工具不越界。
12. 第 4 节说 `pullRepo` 的前置检查含 `no_upstream`，实际**故意不查**：远程跟踪引用
    可能只是还没 fetch 出来，那种情况下真正的失败原因在远程（网络 / 认证），
    交给 `pull` 自己报更准。无上游是 pull 失败后用报错内容兜底识别的。
13. 第 4 节的状态机要求覆盖 `gone`（远程分支已删）。实现上先折叠成了 `no_upstream`
    （而且判定本身就失效，`upstreamGone` 恒为 false）；2026-10 已修正为**独立的
    `gone` 状态**，用 `git for-each-ref --format='%(upstream:track)'` 判定
    （git 自己的权威结论，上游被删时输出 `[gone]`）。
14. 第 9 节说「core 层用 mock」，实际 server 测试**没有任何 `vi.mock`** ——
    全部用临时目录里的真实 git 仓库跑。mock 掉 git 就测不到真正的行为差异。
15. 第 7.1 节列表页的列定义已变（没有「最后 commit 时间」这一列；实际是
    名称 / 本地路径 / 标签 / 落后 / 远程更新 / 推荐 / 上次检查）。
16. 第 7.2 节详情页的「更新到此仓库」单仓库按钮**不存在**：单仓库更新走
    「检查更新」面板 → 勾选 → 「更新选中的」，和批量用同一条路径。
17. 提交图默认只取**当前检出分支**（`git log <branch>`，不是 `--all`）：
    图组件按 `branch` 组织，混入别的分支会让提交的分支归属说不清。
18. 第 7.2 节把 tag 管理放在详情页（原话「不必先点『编辑』弹窗」）。**这条已撤销**：
    详情页那个行内 `TagPicker` 和「编辑资料」弹窗里的「标签」字段是同一份数据的
    两个编辑器，而且保存语义不同（弹窗要按「保存改动」，行内点一下就直接 PUT），
    用户反馈是「两个编辑分不清」。现在标签只有弹窗一个编辑器，详情页的「改标签」
    按钮点开的也是这个弹窗。同一轮还把措辞按**会不会联网**分了家：联网的按钮叫
    「联网检查更新」，只重读本地 git 状态的叫「重读本地状态」——原来「检查更新」
    和「重新读取」两个名字看不出这个区别。
19. **摘要、来源链接、备注列表三样全撤，只剩 `projects.record` 一个文本框。**
    用户原话：「我只想在一个文本框内记录我的如何找到这个项目的过程和对这个项目的
    想法而已，有些我甚至不经过链接，你孤零零的展示链接是何意味」「备注列表又是做
    什么的，到底是给谁看的」。
    错在同一个地方：这三样是照一份**手写 Markdown 清单的行内写法**建的模
    （第 1 节说的前身，一条 bullet 后面挂一个链接），而不是按人怎么记东西建模。
    - `summary`：README 就在本地磁盘上、扫描时本来就读得到（`packages/core` 的
      `firstParagraph`），存一份只会过期。README 那句现在只在扫描预览里出现，不落库。
    - `source_url`：`TEXT` 单列，结构上只允许一个链接；而真实形状是多跳
      （B 站 → 视频里提到的仓库 → GitHub），而且链接常常只在句子里成立。
    - `notes`：是「流」（N 条、各自时间戳、逐条改删），人要的是「文档」（一处、
      持续改）。界面把它做成了没有宿主的评论框。
    现在：迁移 004 删掉那两列与 `notes` 表，加 `record TEXT NOT NULL DEFAULT ''`
    （清空 = 空串，不用 null）；四个 notes 路由、`repos/notes.ts`、`Note` 类型、
    `notesCount` 全部下线；清单页的搜索 `q` 顺带覆盖记录正文。**旧数据按用户要求
    直接丢弃，不做拼接搬运。**
    编辑入口只有「编辑资料」弹窗一个（记录字段就在里面，详情页只读展示、链接可点）；
    原来第一版把记录做成详情页上的文本框 + 「保存记录」，被用户指出「这和顶部的
    编辑资料不有歧义吗」，于是收回弹窗。标签行那个「改标签」快捷入口同理删掉。
