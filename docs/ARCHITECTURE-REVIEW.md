# 架构评审：解耦、边界与语义

**状态：评审完成，待开工。** 这份文档记的是一次全仓通读 + 五个分区独立评审（core / server
routes+repos / server lib+db / web / tauri+跨层）的结论。每条都带 `文件:行` 证据与"为什么是问题"，
按**"会不会说出不成立的话"**排序——那是这个软件的立身之本。

评审基线：`master` @ `3cd14f2`；`pnpm typecheck` 与 `pnpm test` 全绿（**77 个测试文件 / 781 条用例**）。
除标注「推断」外，每条都由读码或 grep 证实。

## 0. 一句话结论

问题不是随手写坏的那种。规则与规则的说法写在一起、注释质量罕见地高、类型全绿。剩下的问题
高度集中在一个模式上：

> **规则的实现有两份（SQL 一份、TS 一份），两份之间没有机器闸门；边界靠注释与测试维持，
> 而不是靠类型或模块结构。**

这个仓库**已经发明了解药**——`ATTENTION_RANK` 由 core 生成 SQL 次序
（[projects.ts:178](../apps/server/src/repos/projects.ts#L178)）、`DEFAULT_SORT_DIR` 两端共读、
`limits.ts` 五个上限共用。**但只在很少几处用了。** 下面绝大多数条目，都是"把这条已发明的做法
推广到别处"。

## 1. 会把"没有依据的话"说给用户的地方（最高优先级）

排第一，因为这正是这个软件的立身之本——文档反复写"绝不拿没依据的数字冒充依据"。

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| 1.1 | **同一条基线（上次见到的上游 SHA）有三套相反的优先级** | ① [inspect/index.ts:207-209](../packages/core/src/git/inspect/index.ts#L207-L209)：**只认数据库那个值**，没有本地 ref 兜底 ② [log.ts:202](../packages/core/src/git/log.ts#L202)：`lastUpstreamSha ?? readUpstreamSha(cwd)`，**数据库优先** ③ [pull.ts:167](../packages/core/src/git/pull.ts#L167)：`local.length > 0 ? local : explicitBaseline`，**本地 ref 优先** | `pull.ts:141-147` 的注释明确论证过：SHA 不带"属于哪条 ref"的信息，拿 A 分支的值问 B 分支**必然是"不是祖先"→ 报"作者改写了历史"的假警报**，而"假警报比判不出来坏得多"。[repos/updates.ts:61-67](../apps/server/src/repos/updates.ts#L61-L67) 也记着"这里踩过一次"。而 ①② 恰好采用了被否掉的优先序 → 切分支后检查会误报 `rewritten`（界面显示**「别拉」**）。**读码**：三处均已通读确认 |
| 1.2 | **`pull` 被跳过时写进 `update_checks`，而 `'ahead'`/`'diverged'` 属于"合格远程检查"** | [pull.ts:251](../packages/core/src/git/pull.ts#L251)、[:254](../packages/core/src/git/pull.ts#L254) `SKIP(..., 'ahead'/'diverged')`；[types.ts:267](../packages/core/src/types.ts#L267) 这两个值在 `REMOTE_CHECK_STATUSES` 里；[updates.ts:284](../apps/server/src/routes/updates.ts#L284) 原样写库（此时 ahead/behind/recommendation 全为 null） | `LATEST_CHECK_JOIN` 取 MAX(id)，于是"上次检查 = 刚刚"却显示**「待检查」**（`ATTENTION_SQL` 无 `ELSE`，落 `unchecked`），真实结论的 ahead/behind 被 null 覆盖。**语义自相矛盾**。**推断**（三段读码串联），建议加一条用例钉死 |
| 1.3 | **`blank()` 返回 `status:'error'` + `error:null`** | [inspect/index.ts:69-90](../packages/core/src/git/inspect/index.ts#L69-L90) | "错误状态 + 没有原因"——正是同一文件 §「读不出来时绝不落到干净那一侧」反复警告的形态。目前只因为所有调用点都被 `unreadable()` 覆盖才没暴露，是定时炸弹。**读码** |
| 1.4 | **`decide`（需要确认）这一档在过滤面板里无法选中** | [FilterPanel.tsx:54](../apps/web/src/features/projects/FilterPanel.tsx#L54) 统计了 `decide`，[:131-158](../apps/web/src/features/projects/FilterPanel.tsx#L131-L158) 只渲染 ready/synced/blocked/unchecked 四项 | `attentionCounts.decide` 是**死字段**。四个可见桶之和**小于**「全部仓库」总数；而 [:98-99](../apps/web/src/features/projects/FilterPanel.tsx#L98-L99) 的注释说"混进不推荐那一档"——代码并没有混（SQL 单独判成 `decide`）。行上有「需要确认」药丸，却没有任何入口能筛出它。**读码** |
| 1.5 | **设置里选的非内置图标，在设置列表里不显示、左栏却显示** | [CategorySection.tsx:25-30](../apps/web/src/features/settings/CategorySection.tsx#L25-L30) 自建 **4 项**本地映射，[:112](../apps/web/src/features/settings/CategorySection.tsx#L112) 用它渲染；真注册表 94 项在 [icons.tsx:112](../apps/web/src/features/categories/icons.tsx#L112)、`categoryIcon()` 在 [:233](../apps/web/src/features/categories/icons.tsx#L233)，左栏走后者 | 已成立的显示不一致。附带 [:22](../apps/web/src/features/settings/CategorySection.tsx#L22)「图标这一轮只展示不选」是过期注释（[:138](../apps/web/src/features/settings/CategorySection.tsx#L138)/[:198](../apps/web/src/features/settings/CategorySection.tsx#L198) 已用 IconPicker）。**读码** |
| 1.6 | **批量 `/status` 对未知 id 返回 200 + 伪造状态，单条接口同样情况返回 404** | [git.ts:145](../apps/server/src/routes/git.ts#L145) `statusByPath.get(path) ?? missingStatus(path)`；[:126-134](../apps/server/src/routes/git.ts#L126-L134) `loadPaths` 用 `''` 占位 | 两个接口对"这个项目不在清单里"给出两种结论；且 `missingStatus` 的 `status:'missing'` 与 message「清单里没有这个项目」是两件事共用一个字段。**读码** |
| 1.7 | **README 缓存从不失效** | [queryKeys.ts:80](../apps/web/src/lib/queryKeys.ts#L80) 有 `readme` 键，[invalidate.ts:25-32](../apps/web/src/lib/invalidate.ts#L25-L32) 六个根里没有它 | 改了项目路径之后，详情栏一直渲染**旧仓库**的文档（正确性，不是性能）。**读码** |
| 1.8 | `/preview` 开发用图标页无条件挂在路由上 | [App.tsx:48](../apps/web/src/App.tsx#L48) | 打包产物里可达。**读码**（次要） |

## 2. 功能边界：谁负责什么

### 2.1 `lib/git.ts` 一个模块三种身份（最值得动）

[lib/git.ts](../apps/server/src/lib/git.ts) 同时是：① 唯一 `Scheduler` 持有者（[:44](../apps/server/src/lib/git.ts#L44)）
② 两张状态缓存持有者（[:66-67](../apps/server/src/lib/git.ts#L66-L67)）③ core 函数的**裸透传**
（[:23](../apps/server/src/lib/git.ts#L23) 又导出 `pullRepo`/`getRepoStatus`/…）④ 业务包装
（注入 `lastUpstreamSha`、传输方式会话）。由此产生四个具体后果：

- **唯一的并发闸可以被 `import` 绕过。** [:37-43](../apps/server/src/lib/git.ts#L37-L43) 的注释说
  "全局只有这一个实例，所有入口都必须把 scheduler 传下去"，但裸 re-export 让
  `import { pullRepo } from '../lib/git.ts'` 能编译能跑，落到 core 的 `defaultScheduler`
  （并发写死 4，[scheduler.ts:81](../packages/core/src/git/scheduler.ts#L81)）→ 同仓库串行失效
  → 正是要防的 index.lock 竞争。**这条不变量只靠注释 + 2 个测试维护。**
- **循环依赖**：[:19](../apps/server/src/lib/git.ts#L19) 读 `settings.ts`，而
  [settings.ts:3](../apps/server/src/lib/settings.ts#L3) 反过来 import `clearStatusCache`——
  设置模块的职责里悄悄包含了"另一个模块的缓存"。
- **缓存失效是调用方的义务**，散在 5 处：`settings.ts:102`、`routes/index.ts:129,138`、
  `routes/updates.ts:239,313`（`routes/scan.ts:185` 只因写 `scanDirs` 就清整个状态缓存）。
  任何新写入点忘了调用，就会在 3 秒窗口里把旧状态当新事实返回。
- `app.ts:26` 的 `bindSettings(db)` 成了**隐式启动顺序依赖**（[:27-28](../apps/server/src/app.ts#L27-L28) 注释自认）。

### 2.2 分层契约 `routes → repos → db` 名存实亡

7 处路由/库层直接写 SQL：[routes/git.ts:126](../apps/server/src/routes/git.ts#L126)、
[:173](../apps/server/src/routes/git.ts#L173)、[routes/updates.ts:144](../apps/server/src/routes/updates.ts#L144)、
[routes/logo.ts:41](../apps/server/src/routes/logo.ts#L41)、[routes/scan.ts:178](../apps/server/src/routes/scan.ts#L178)、
[auto-fetch.ts:68](../apps/server/src/lib/auto-fetch.ts#L68)、[app.ts:67](../apps/server/src/app.ts#L67)。
`projects` 表被 5 份列集不同的 SELECT 各写一遍；`is_own` 的 0/1→boolean 只在
[projects.ts:85](../apps/server/src/repos/projects.ts#L85) 转换，所以路由层拿到的是 `isOwn: number`。
加一列要找 5 处。实际依赖图是 `routes → {repos, lib} → db`，与文档写的不是一回事。

### 2.3 `tasks.ts` 与 `auto-fetch.ts` 是两套互不相干的任务生命周期

- [tasks.ts:39](../apps/server/src/lib/tasks.ts#L39) 是一个内存 `Map`；[:27](../apps/server/src/lib/tasks.ts#L27)
  的状态机没有 `cancelled`。**全仓没有任何取消实现**（[:138-139](../apps/server/src/lib/tasks.ts#L138-L139) 注释自认）。
- 而 [DESIGN.md:248](./DESIGN.md#L248) 写着：「扫描与 Fetch 使用受控并发，并提供进度、**失败重试与取消**。」
  —— 进度只有 Fetch 有（scan 没有 SSE），**取消与重试都没有**。
- [auto-fetch.ts:57](../apps/server/src/lib/auto-fetch.ts#L57) 用另一个 `inFlight` 变量合流；
  [diagnostics.ts:43](../apps/server/src/routes/diagnostics.ts#L43) 同步 `await runAutoFetch(db)`（挂住整轮 HTTP），
  而手动检查是 202+SSE。**同一动作两套生命周期**，且 `runAutoFetch(db)` 的 `db` 形参在合流分支被静默忽略。
- `Task.status`（[:27](../apps/server/src/lib/tasks.ts#L27)）与 `TaskItem.state`（[:19](../apps/server/src/lib/tasks.ts#L19)）
  是同义两个词。

### 2.4 `attention`/`verdict` 的判据住在 server 的一条 SQL 字符串里

[projects.ts:68-77](../apps/server/src/repos/projects.ts#L68-L77) 的 `ATTENTION_SQL` 用 `json_extract`
重写了 [recommend.ts:105-138](../packages/core/src/git/inspect/recommend.ts#L105-L138) 的同一套映射。
core 注释自认"读 core 的人猜不出 `blocked` 和 `decide` 差在哪"
（[types.ts:357-360](../packages/core/src/types.ts#L357-L360)）。而这条 SQL 的 CASE **没有 `ELSE`**：
core 将来加一个 verdict 时，TS 侧返回新值，SQL 侧静默落进 `'unchecked'`。

### 2.5 Rust 壳不"只管窗口与 sidecar"

[DESIGN.md:245](./DESIGN.md#L245) 写「壳…连业务逻辑都不碰」。实际 `lib.rs` 还承担：数据根规则 +
可写探测 + 失败文案（`:41-117,601-628`）、WebView2 环境变量与该机器特有的"换卷"理由（`:202-236`）、
**服务端 CORS 白名单政策**（`:441-447`，与 [config.ts:32-38](../apps/server/src/config.ts#L32-L38) 的
`tauriOrigins` 是同一事实两份，注释自认未在真机核实）、日志等级与落点（`:547-558`）、窗口几何 1280×840
（README 里还有两份）。失败策略也不一致：数据根不可写 → panic，`EBWebView` 建不出来 → 只打日志继续。

## 3. 语义模糊与文档漂移

### 3.1 命名：读名字判断不出用途

| 词 | 几义 | 证据 |
|---|---|---|
| **`repos/`** | 目录名指 repository 模式（DB 访问层），而仓里 `repo` 一律指 **git 仓库** | [scan.ts:9](../apps/server/src/routes/scan.ts#L9) import `../repos/projects.ts`，同文件 [:72](../apps/server/src/routes/scan.ts#L72) 又 `.map((repo) => …)` 遍历 git 仓库；[git.ts](../apps/server/src/routes/git.ts) 的 `repoStatus/repoFacts/repoLog` 指 git 仓库。判断：`project`（管理记录）与 `repo`（磁盘事实）可以并存，**错的是目录名**——建议改 `store/` |
| **`status`** | 5 义 | `RepoStatus.status`（仓库事实）／`UpdateCheckSummary.status`（落库结果）／`LastUpdateAttempt.status`（最近一次尝试）／[PullResult.status](../packages/core/src/git/types.ts#L153)（**闸门原因**，与 `PullOutcome`+`reason`+`summary`+`error` 五字段描述同一件事）／`Task.status` |
| **`check`** | 名字读起来只读，实际**联网并改 `refs/remotes/*`** | 一条链四个名字：[updates.ts:69](../apps/server/src/routes/updates.ts#L69) `post('/updates/check')` → [lib/git.ts:179](../apps/server/src/lib/git.ts#L179) `analyze` → [log.ts:163](../packages/core/src/git/log.ts#L163) `analyzeUpdates` → `fetchWithFallback` |
| **`记录`** | 4 义 | 用户写的 Markdown（[ProjectDetailPage.tsx:300](../apps/web/src/pages/ProjectDetailPage.tsx#L300)）／命令日志（[CommandsSection.tsx:169](../apps/web/src/features/settings/CommandsSection.tsx#L169)）／`update_checks` 历史（[ProjectRow.tsx:37](../apps/web/src/features/projects/ProjectRow.tsx#L37)）／DB 行（[RemoveDialog.tsx:12](../apps/web/src/features/projects/RemoveDialog.tsx#L12)） |
| **`Scheduler`** | core 里是**并发闸**，真正的定时调度在 auto-fetch | [scheduler.ts:13](../packages/core/src/git/scheduler.ts#L13) vs [auto-fetch.ts](../apps/server/src/lib/auto-fetch.ts) |
| **`ProjectDetail`** | 与 `ProjectListItem` 同一个类型、两个名字 | [types.ts:445](../packages/core/src/types.ts#L445) `export type ProjectDetail = ProjectListItem`，会让人以为详情有额外数据 |
| `UpdateVerdict` | 与 `UpdateStatus` **成员同名**，且有不可达成员 | [types.ts:150](../packages/core/src/types.ts#L150) 的 `gone`/`no_upstream`，`applyVerdict` 只可能返回前四个，但 [projects.ts:483](../apps/server/src/repos/projects.ts#L483) 的 `isVerdict` 认它们 |
| 文件/导出名 | `ListToolbar.tsx` 导出 `Toolbar`；`pages/ProjectDetailPage.tsx` 其实不是页（是详情栏内容，DESIGN §7），真清单页在 `features/` 下；`ScanSection` 已搬出设置却还叫 Section；`PreviewPage` 与编辑器的"预览"同名不同物 | — |

### 3.2 同一条规则的多份拷贝（跨层）

| 规则 | 份数 | 位置 |
|---|---|---|
| **"问过远程的四种状态"** | **3 份** | core [types.ts:267](../packages/core/src/types.ts#L267) + `isRemoteCheckStatus`（[:285](../packages/core/src/types.ts#L285)）／web [text.ts:44](../apps/web/src/features/status/text.ts#L44) `REMOTE_CLAIMS`／server [updates.ts:230](../apps/server/src/routes/updates.ts#L230) `COUNTED`。**三份独立评审各自指认了这一条**——core 已有谓词，这两处却手抄 |
| 空/占位 `RepoStatus`（18 字段字面量） | **4 份** | [inspect/index.ts:69](../packages/core/src/git/inspect/index.ts#L69) `blank`／[lib/git.ts:146](../apps/server/src/lib/git.ts#L146) `unreadableStatus`／[routes/git.ts:149](../apps/server/src/routes/git.ts#L149) `missingStatus`／`via-lib.ts:73` |
| `GitErrorKind` 9 个字面量 | 2 份 | [git/types.ts:24-42](../packages/core/src/git/types.ts#L24-L42)（仅类型）／[projects.ts:425-435](../apps/server/src/repos/projects.ts#L425-L435) `GIT_ERROR_KINDS`。加一个 kind 后旧记录被判"没有原因"，界面只说"没有原因" |
| `RemoteTransport` | 2 份 | [fetch.ts:25](../packages/core/src/git/fetch.ts#L25)（仅类型）／[transports.ts:21](../apps/server/src/repos/transports.ts#L21) `VALID = ['https','ssh']` |
| 数值设置边界 | 2 份 | [settings.ts:35-37](../apps/server/src/lib/settings.ts#L35-L37) zod 边界／[:46-50](../apps/server/src/lib/settings.ts#L46-L50) `RANGES`，注释自称"必须一致" |
| `120_000` | 3 份 | [runner.ts:15](../packages/core/src/git/runner.ts#L15)／[settings.ts:26](../apps/server/src/lib/settings.ts#L26)／[lib/git.ts:77](../apps/server/src/lib/git.ts#L77)（连 `DEFAULT_SETTINGS` 都没复用） |
| 路径归一化 | 3 份 | [lib/paths.ts:22](../apps/server/src/lib/paths.ts#L22) 是**唯一正确版**（UNC/`\\?\`/驱动器根都单独处理）／[scan.ts:190](../packages/core/src/git/scan.ts#L190)／[scheduler.ts:95](../packages/core/src/git/scheduler.ts#L95) 是弱版本 → "同一个仓库"的判定键可能与入库路径对不上 |
| `update_checks.detail` 解码器 | 4 个 | `repos/updates.ts:69,102`、`repos/projects.ts:445,470`，各自 try/catch 与强度不同的守卫 |
| "最近一次合格检查" SQL 片段 | 3 份 | [projects.ts:49,52](../apps/server/src/repos/projects.ts#L49-L52)／[:363-372](../apps/server/src/repos/projects.ts#L363-L372)／[updates.ts:106-113](../apps/server/src/repos/updates.ts#L106-L113)。`updates.ts:97` 注释自己写"必须与清单页读的是同一批行"，但无机制保证 |
| wire 类型 | 两端各一份 | `Task`/`TaskSnapshot`/`StreamEvent`（web 版 [taskStream.ts:26-31](../apps/web/src/features/updates/taskStream.ts#L26-L31) **已漂移**：服务端发的 `started{total,kind}` 与 `item.total` web 都没有，`{type:'started'}` 成死分支）、`Settings`、`ProjectStatus`、`ReadmeResult`、`ScanResponse` |
| 端口**数字** | ✅ 1 份 | 但**解析实现 4 份**（见 §5.7） |

### 3.3 文档与代码不一致

- **[DESIGN.md:248](./DESIGN.md#L248)**：「提供进度、失败重试与取消」——取消与重试**零实现**，进度只有 Fetch 有。
- **[DESIGN.md:245](./DESIGN.md#L245)**：「壳连业务逻辑都不碰」——见 §2.5。
- **默认排序三处说法互相矛盾**：[types.ts:382](../packages/core/src/types.ts#L382) 与
  [schemas.ts:78](../packages/core/src/schemas.ts#L78) 都写"默认 `name`"，而
  [store/ui.ts:25](../apps/web/src/store/ui.ts#L25) 与 [queryKeys.ts:42](../apps/web/src/lib/queryKeys.ts#L42)
  写"服务端默认（分类分组 → 名称）"——**行为是后者**（[projects.ts:196-199](../apps/server/src/repos/projects.ts#L196-L199)
  的 `default:` 分支按 category → sort_order → name）。顺带这个 `default:` 分支不看 `dir`，
  所以 `?dir=desc` 不带 `sort` 会被静默忽略。
- **`build-sidecar.mjs:67-69` 的注释与事实相反**（三方矛盾）：它说 resources 的 glob 前缀会被剥掉，
  而 `SIDECAR.md:103` 与 `lib.rs:385-387` 说保留。文件头画的布局（`binaries/git-nest-server/` 内含
  `node.exe`）也与磁盘实况不符。
- **`run.cjs` 从未被执行，三处文档却称它是壳的 argv[1]**：`lib.rs:399/318` 实际传 `index.mjs`；
  `build-sidecar.mjs:224`、`smoke-sidecar.mjs:16`、`SIDECAR.md:36` 都说是 `run.cjs`。
  冒烟脚本的 `bin` 变体测的正是这条不存在的路径。
- **`src-tauri/README.md:128`** 引的 CSP 写作 `connect-src … http://localhost http://127.0.0.1`，
  实际 `tauri.conf.json:13` 是 `http://localhost:* http://127.0.0.1:*`。
- **环境变量的"收口"名不副实**：README 只列 `GIT_NEST_API/PORT/CORS`，实际还有 `GIT_NEST_HOST`、
  `GIT_NEST_DB`、`GIT_NEST_TAURI_ORIGIN`，散在 `config.ts` 与 `SIDECAR.md` 里，没有单一表格。

### 3.4 类型结构本身是环

[types.ts:7](../packages/core/src/types.ts#L7) 从 `./git/types.ts` 引 `GitError/UpdateStatus`，而
[git/types.ts:3,5](../packages/core/src/git/types.ts#L3) 又从 `../types.ts` 引 `UpdateRecommendation/UpdateVerdict`
并再导出 —— **依赖方向是环而非分层**，两个模块互为对方的"底下那层"。

[types.ts](../packages/core/src/types.ts)（452 行）是个 god file，同时装着：传输 DTO、状态机 `deriveStatus`、
策略文案表、排序策略、进程配置 `DEFAULT_PORTS`。改一个端口号要让 web bundle 拉进状态机所在的文件。

**并且"浏览器安全"只靠注释维持**：[index.ts:7](../packages/core/src/index.ts#L7) 写了"git 层依赖
`node:child_process`，浏览器端一碰就会炸"，但 `package.json` 没有 `browser`/`node` conditions，
**而且没有任何测试 import 过这两个 barrel** —— 边界写错了，没有任何东西会红。

## 4. 解耦候选（按"一处改动、收益最大"排序）

1. **拆 `lib/git.ts` 为三层**，并删掉裸 re-export：`gitScheduler.ts`（唯一 Scheduler + limit 同步）／
   `statusCache.ts`（两张 Map + 失效）／`gitFacade.ts`（只导出包装函数）。一次解掉 §2.1 的四个后果。
   调用点里只有 `readReadme` 真的需要透传（它不吃 scheduler），单独留 core 即可。
2. **core 出 `emptyStatus(path, reason)` 工厂** → 4 份 18 字段字面量收敛成 1 份；顺带把"项目不在清单"
   与"目录不在了"分开（现在共用 `missing`）。
3. **把三个判据变成 core 纯函数**（都已有测试先例）：
   - `verdict, canPull → Attention`（落库时算，SQL 只读短码）→ 解掉 §2.4（含 §5.5 的索引问题）
   - `ahead, behind → UpdateStatus`（现在 [types.ts:337-340](../packages/core/src/types.ts#L337-L340)、
     [log.ts:315-318](../packages/core/src/git/log.ts#L315-L318)、[pull.ts:242-255](../packages/core/src/git/pull.ts#L242-L255) 三份）
   - **`取基线`（含优先级与理由）** → 解掉 §1.1。三个调用点只传数据库那个值
4. **一个 `decodeDetail()`** 替掉 4 个解码器；`GitErrorKind`/`UpdateStatus`/`RemoteTransport` 照
   `ATTENTION_VALUES` 的做法加 `as const` 数组 + 谓词，server 从 core 生成 `Set`。
5. **wire 类型下沉 core**（`Task`/`TaskSnapshot`/`StreamEvent`/`Settings`/`ProjectStatus`/`ReadmeResult`/`ScanResponse`），
   联合类型加显式判别字段替掉 `'incoming' in r` 鸭子类型。
6. **统一校验入口**：[routes/index.ts:44](../apps/server/src/routes/index.ts#L44) 的 `parse()` 与各路由直接
   `schema.parse()` 给两种响应体（一句"提交的内容有误"、一句"参数有误"），而 `parse` 被 export 却**无人 import**。
   用 `setValidatorCompiler` 收口。
7. **`projectType` 落库缓存**（照 `project_logos` 的 README 指纹做法）——见 §5.1。
8. **路径归一化下沉 core**，`lib/paths.ts` 只留 `~` 展开与 `process.cwd()` 解析。
9. **`lib/git.ts:77` 复用 `DEFAULT_SETTINGS`**；未 `bindSettings` 时**抛错**而不是静默降级
   （现在"忘了绑定"表现为"设置页不生效"）。与第 1 条的 `statusCache` 一起做最省。
10. **前端**：`store.Filters` 直接等于 `ListParams`（现在两份同形声明）；抽 `useAnchoredLayer()` 给
    `Select`/`IconPicker`（同一套 portal+翻转+rAF+捕获 Escape 已复制，且行为**已分叉**）；
    `UpdatePanel` 拆 `useApplyRun()` + `summaries.ts`（纯函数可单测）+ 行组件外移；
    合并两个同名 `RemoveDialog`（[projects/RemoveDialog.tsx:17](../apps/web/src/features/projects/RemoveDialog.tsx#L17)
    的注释声称"另一个用的是同一个组件"，事实相反）。
11. **脚本层**：端口解析逻辑抽成一个共享模块（现在 `build.rs`、`gen-tauri-dev-config.mjs`、`build-sidecar.mjs`、
    `smoke-sidecar.mjs` **各写一套扫 `DEFAULT_PORTS` 的代码**）；`build.rs` 只生成 `ports.rs`，
    `gen/app.config.json` 只留一个写入者；sidecar 布局常量共享，`smoke-sidecar.mjs:27` 硬编码的
    `D:\Git\personal\git-nest` 与 `:43` 硬编码 triple 换机器即失效。
12. **语义收敛**：`PullResult` 用独立的 `skipReason`（闸门枚举）而不是往 `UpdateStatus` 里塞（§1.2 的根因）；
    `ProjectDetail` 别名删掉或注释清。

## 5. 性能优化

1. **`GET /projects` 每次做全量磁盘富化，而前端为了计数又打一次全量** ⭐
   [routes/index.ts:60-61](../apps/server/src/routes/index.ts#L60-L61)：`scanLogos` +
   `Promise.all(projects.map(detectProjectType))`。`detectProjectType` 每次 readdir + 最多几十 KB
   清单文件读（[project-type.ts:209](../packages/core/src/git/project-type.ts#L209)、
   [:307-309](../packages/core/src/git/project-type.ts#L307-L309)），**无缓存、`Promise.all` 不限并发**；
   而 logo 有 `project_logos` 指纹缓存。再叠加 [FilterPanel.tsx:31](../apps/web/src/features/projects/FilterPanel.tsx#L31)
   **故意**再发一次不过滤的 `useProjects` 用于全量计数 → 开销 ×2。加上
   [invalidate.ts:25-32](../apps/web/src/lib/invalidate.ts#L25-L32) 每次写操作失效 6 个根，
   任何一个标签改动都会触发这一整套。
   → projectType 落库缓存；服务端直接给计数（`GROUP BY attention`）。顺带：
   `routes/index.ts:70` 返回的 `total` 是**死字段**，web 用的是 `projects.length`
   （[ProjectsPage.tsx:80](../apps/web/src/features/projects/ProjectsPage.tsx#L80)）。
2. **`readSettings` 在每次 git 操作前全表读一遍**，[lib/git.ts:86-87](../apps/server/src/lib/git.ts#L86-L87)
   还一次读两遍（`current()` 调了两次）。批量 200 仓库时每仓库至少一次全表扫描 + Map 构造。
   → 设置读缓存 + `writeSettings` 是天然失效点（与 §4.9 合并做）。
3. **SSE 实现**：[updates.ts:357](../apps/server/src/routes/updates.ts#L357) 150ms 轮询 +
   [tasks.ts:32](../apps/server/src/lib/tasks.ts#L32) 无上限事件缓冲；`markDone` 序列化整个 `UpdateReport`
   （含 incoming/outgoing 全部提交），而 [tasks.ts:81-83](../apps/server/src/lib/tasks.ts#L81-L83) 每次 `slice` 复制。
   → 改推送式，事件只带进度与 id。
4. **`Scheduler.queue` 是纯 FIFO，没有前台/后台优先级**：自动 fetch 一次把全部候选塞进队列
   （[auto-fetch.ts:100](../apps/server/src/lib/auto-fetch.ts#L100)），前台用户点一次单仓库 pull
   要排在同一仓库的后台轮次之后。
5. **`LATEST_CHECK_JOIN` 是相关子查询 + `json_extract`，用不上索引**
   （[migrations.ts:59](../apps/server/src/db/migrations.ts#L59) 只有 `(project_id, checked_at DESC)`）。
   → §4.3 落 `attention` 列 + 建索引，一并解决。
6. **`auto-fetch` 同步挂住整轮 HTTP**（`diagnostics.ts:43`），浏览器断开后服务端照跑照写库。
7. **端口只有一个数字，却有四份解析实现**：`build.rs:78-107`、`gen-tauri-dev-config.mjs:37-45`、
   `build-sidecar.mjs:82-93`、`smoke-sidecar.mjs:32-34` 各写一套扫 `DEFAULT_PORTS` 的逻辑；
   `build.rs:58-64` 与 `gen-tauri-dev-config.mjs:52-56` 还写同一个 `gen/app.config.json`。
   单点改格式就会让四处的 `panic`/`throw` 一起炸。
8. **migrations 没有 schema 指纹**：[:6-7](../apps/server/src/db/migrations.ts#L6-L7) 的约定是
   "改结构 = 改这里 + 删库重建"，但 `schema_migrations` 只记 id，于是**同一个 id 在老库与新库得到
   不同结构**，失败形态是运行期 `no such column`。最低成本改法：加一列 `schema_hash`，启动时比对并
   明确报"库是旧结构，删 `data/git-nest.db*` 重建"。
9. **`migrations.ts:125` 内联 `BUILTIN_CATEGORIES`**：改一个内置分类的 label/icon 后，老库保留旧值、
   新库是新值，**没有任何回补路径**（测试全用新库，测不到）。迁移应写死当时的字面快照，另加幂等启动对账。
10. **`check-encoding.mjs:39` 的 `SKIP_DIRS` 不含 `src-tauri/gen`、`src-tauri/binaries`**：
    实测扫到的 230 个文件里有 5 个 gitignored 生成物（含 2.9MB 的 bundle）→ 闸门不 hermetic。

## 6. 已核实**不是**问题（省复查）

- 端口**数字**真的只有一处（[types.ts:264](../packages/core/src/types.ts#L264)）——虽然解析实现有 4 份
- `DEFAULT_SORT_DIR` 两端都真的读了（[projects.ts:153-154](../apps/server/src/repos/projects.ts#L153-L154)、
  [ui.ts:117](../apps/web/src/store/ui.ts#L117)）
- `queryKeys.projects({})` 的前缀失效**有效**（已核对 `@tanstack/query-core@5.104` 的 `partialMatchKey`：
  `{}` 走"按 filter 键"分支返回 true，[invalidate.ts](../apps/web/src/lib/invalidate.ts) 的注释是对的）
- 前端**没有**重算 `attention`，只读服务端结论（[ProjectRow.tsx:163-168](../apps/web/src/features/projects/ProjectRow.tsx#L163-L168)、
  [FilterPanel.tsx:48-63](../apps/web/src/features/projects/FilterPanel.tsx#L48-L63)）
- **Tauri 边界守住了**：`apps/web/src` 内 `@tauri-apps` 零 import，只有
  [desktop.ts:20](../apps/web/src/lib/desktop.ts#L20) 读 `__TAURI__`
- `limits.ts` 的五个上限 web/server 都真的从 core 引
- 12 小时那条线只有一份（[text.ts:23](../apps/web/src/features/status/text.ts#L23)）
- 全仓无 `any`、无未引用的模块级死文件
- `scan.ts` 每个候选 2 条 git 进程是刻意的（insteadOf 一致性），`bench-status.mjs` 深引模块而非 barrel 也是对的
- `inspect` 的 full 档已复用 `readDivergence`，进程数控制良好

## 7. 建议的执行顺序

按"收益 / 风险"排，每批都能独立提交、独立验证。

| 批次 | 内容 | 验收 |
|---|---|---|
| **第一批：先把会说假话的修掉** | §1.1 基线优先级（三处收成一个 core 函数）／§1.2 `PullResult.skipReason`／§1.3 `blank()`／§1.4 `decide` 桶／§1.5 图标表／§1.6 未知 id／§1.7 README 失效 | 每条配一个用例：`decide` 可筛且计数加总；切分支后不误报 `rewritten`；跳过 pull 不刷新"合格检查"；README 在改路径后重新拉取 |
| **第二批：把判据收回 core** | §4.2 `emptyStatus`／§4.3 三个纯函数／§4.4 `decodeDetail` + `as const` 数组／§4.5 wire 类型 | 新增一个 `Attention` / `UpdateStatus` / `GitErrorKind` 时，**只有 core 一处需要改**，其余地方编译期报错 |
| **第三批：拆结构** | §4.1 `lib/git.ts` 三层 + 删裸 re-export／§4.6 统一校验／§4.7 projectType 缓存／§4.8 路径归一化 | 删掉 re-export 后全仓编译仍通过；未 `bindSettings` 时抛错而不是静默降级；`GET /projects` 不再逐项目读盘 |
| **第四批：收文档与脚本** | §3.3 全部条目／§5.7 脚本共享常量／§5.10 编码闸门 | `DESIGN.md` 不再承诺未实现的取消/重试；默认排序只有一种说法；`smoke-sidecar.mjs` 不再硬编码仓库路径与 triple |

**如果只做一件事：第一批。** 大多是几行改动，收益是这个项目的核心承诺。
**如果只做一件重构：§4.1 拆 `lib/git.ts`。** 一次解掉四个边界问题，且不需要动 core。
