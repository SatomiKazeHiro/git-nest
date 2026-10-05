# git-nest 代码审计报告（DS）

日期：2026-10-05
审计者：DeepSeek Harness（独立审计，**未读** `docs/AUDIT-2026-10-05.md`，写完本文件之后才去对照）
范围：`packages/core`、`apps/server`、`apps/web`、`scripts`、各配置与文档（刻意不看上面那份审计，避免被它的结论带跑）

---

## 0. 方法与基线

**怎么查的**

1. 全量读源码（core 的 git 执行层 / inspect 两条路、server 的路由与 repos、web 的页面与 query 层）。
2. 跑基线：`pnpm typecheck`（三包全过）、`pnpm test`（**36 个文件 / 332 个用例全绿**，52s）、`pnpm check:encoding`（115 文件无 U+FFFD）。
3. 对每一个怀疑点**动手复现**，不靠读代码下结论。复现方式见下面每条的证据与第 5 节附录：
   - 用 react-query 自己的 `matchQuery` / `QueryClient.invalidateQueries` 验证失效键到底匹不匹配；
   - 用 vitest + msw 把详情页/设置页真的渲染出来，走一遍「编辑 → 保存」；
   - 用 `app.inject` 打真实接口（标签、导入、update_checks 判决）；
   - 用 `[IO.File]::ReadAllBytes` 读 git 自己的二进制，验证它认不认某个环境变量。
4. 每条结论都标注了是**实测复现**还是**仅静态推理**。

**基线事实**

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 三个包全过 |
| `pnpm test` | 36 files / 332 tests 全过（52.17s） |
| `pnpm check:encoding` | 通过（115 文件） |
| 未提交改动 | 只有 `docs/AUDIT-2026-10-05.md` 一个未跟踪文件 |

**总体判断（先说结论）**

这个项目的**骨架是好的**：不变量写得清楚且基本都真的落到了代码里（`pull` 只 ff-only、同仓库串行+跨仓库并发、状态不落库、判决必须落库并说明来源、自动行为必须留痕），core 的 git 层有真实的集成测试兜底，`docs-api-drift.test.ts` 这种「拿文档对账代码」的测试在个人项目里很少见。**我找到的问题绝大部分不在「安全闸」上，而在两类地方：**

1. **写完之后界面不刷新 / 显示与事实不一致**（详情页保存后不更新、目录不在了被说成「不是 git 仓库」）——这类问题测试全绿，因为现有测试只渲染子组件，从不走完整的 mutation→invalidate 链路。
2. **同一条规则在两个入口上只把了一道关**（标签长度、导入查重、判决读哪一行）——典型的是「A 入口校验、B 入口不校验」。

严重度最高的一条（P1-1）会让用户以为改动没保存，是最容易被当成「这工具坏了」的那类 bug。

---

## 1. 结论速览

| # | severity | 问题 | 位置 | 证据 |
|---|---|---|---|---|
| P1-1 | 高 | 编辑资料保存后，详情页与本弹窗**不重新取数**，一直显示旧值（记录/名称/路径/分类/标签都是） | `apps/web/src/features/projects/queries.ts:66` | 实测复现 |
| P1-2 | 高 | 详情页「git 状态」摘要把 `missing`（目录不在了）和 `error`（读不出来）都说成「**不是 git 仓库**」，与同页顶部横幅自相矛盾 | `apps/web/src/pages/ProjectDetailPage.tsx:225-236` | 实测复现 |
| P2-1 | 中 | 服务端拦「别拉」读的是**最新一行** `update_checks`，清单页显示的是**最新一条远程结论**一行；两者可以不一致——界面写着「别拉」，服务端那道闸已经松了 | `apps/server/src/repos/updates.ts:85`、`apps/server/src/repos/projects.ts:203-212` | 实测复现 |
| P2-2 | 中 | 设置页三个数字输入框**每次按键就 PATCH**，且显示值由服务端回值驱动 → 清空后打的第一个字符会被弹回原值（想改成 60000 只能一个字符一个字符地删） | `apps/web/src/pages/SettingsPage.tsx:80-118`、`features/settings/queries.ts:20-28` | 实测复现 |
| P2-3 | 中 | 标签名「最长 40 字」只在 `POST /api/tags` 把关；`PUT /api/projects/:id/tags` 能塞进任意长度的标签名（实测 200 字入库） | `packages/core/src/schemas.ts:43` vs `:53` | 实测复现 |
| P2-4 | 中 | 批量导入时若批内两条路径指向同一个目录（大小写变体/短名/链接），**整批回滚**并返回一个误导性的 409「这条记录已经存在了」 | `apps/server/src/routes/scan.ts:106-119` | 实测复现 |
| P3-1 | 低 | 两处注释与实现不符：lean 档不是「1 条 git 命令」而是 2 条 | `inspect/index.ts:4-11`、`lib/git.ts:116` | 静态+对照测试注释 |
| P3-2 | 低 | 源码注释里有 HTML 转义字符 `&lt;dir&gt;`；`check:encoding` 只查 U+FFFD，查不出这种 | `packages/core/src/git/runner.ts:18` | 实测（脚本通过） |
| P3-3 | 低 | 三处指向**不存在的东西**：`inspect-lib.test.ts`（文件不存在）、「迁移 003」（迁移只有 001/002）、`@tomplum/react-git-log`（依赖已删） | `via-lib.ts:9`、`repos/projects.ts:167`、`apps/web/vitest.config.ts:21` | 实测 |
| P3-4 | 低 | `GIT_PROGRESS=0` 不是 git 认识的环境变量（只有 `GIT_PROGRESS_DELAY`），是无效的死配置 | `packages/core/src/git/pull.ts:43` | 实测（读 git 二进制） |
| P3-5 | 低 | `update_checks` **只写不删**，自动 fetch 每 30 分钟给每个仓库写一行；无任何清理/归档 | `repos/updates.ts:36`、`lib/auto-fetch.ts:92` | 静态（全局 grep 无 DELETE） |
| P3-6 | 低 | `POST /api/auto-fetch` 同步等整轮跑完；而这一轮是**严格串行**的，settings 里的 concurrency 对它无效 | `lib/auto-fetch.ts:82-99`、`routes/diagnostics.ts:42` | 静态 |
| P3-7 | 低 | `runCheck` 在拿到并发许可**之前**就把所有行标成「检查中…」，200 个仓库会同时显示在跑 | `routes/updates.ts:170-185` | 静态 |
| P3-8 | 低 | `/projects/:id/log` 为了判「是不是仓库、分支叫什么」跑了一次 **full+fresh** 的状态读取（3–4 条 git 进程），只为两个字段 | `routes/git.ts:56-76` | 静态 |
| P3-9 | 低 | 「编辑资料」弹窗的表单重置依赖整个 `editing` 对象身份；弹窗开着时只要该 query 重取一次，用户没保存的输入就会被覆盖 | `features/projects/ProjectFormDialog.tsx:58-75` | 静态 |
| P3-10 | 低 | 若干一致性/死代码：`hostOf` 无人引用的导出、`createProjectSchema.path` 无长度上限而 `updateProjectSchema.path` 有 `max(400)`、`core/tsconfig.json` 同时写 `noEmit` 与 `outDir`（`build` 脚本实际什么都不产出）、`lib/git.ts` 的 `getRemoteUrl` 靠「忘了传 scheduler」才没自锁 | 多处 | 静态 |

---

## 2. 逐条发现

### P1-1 编辑资料保存后，详情页/弹窗不刷新（实测复现）

**现象**：在详情页点「编辑资料」，改「记录」后保存；保存确实成功了（服务端返回了新数据），但页面**仍然显示旧记录**。立刻再点开「编辑资料」，弹窗里也是旧值——用户会认为「改了没保存」。

**根因**：`useInvalidate()` 里用 `queryKeys.project(0)`（即 `['project', 0]`）当「所有项目详情」的前缀：

```ts
// apps/web/src/features/projects/queries.ts:62-71
void qc.invalidateQueries({ queryKey: queryKeys.projects({}) })   // ← 这个能匹配（见下）
void qc.invalidateQueries({ queryKey: queryKeys.project(0) })     // ← 只匹配 ['project', 0]，匹配不到 ['project', 5]
void qc.invalidateQueries({ queryKey: queryKeys.tags })
void qc.invalidateQueries({ queryKey: queryKeys.status })
void qc.invalidateQueries({ queryKey: queryKeys.settings })
```

react-query 的失效是**前缀匹配**，而 `['project', 0]` 不是 `['project', 5]` 的前缀（`['project']` 才是）。`['project', 0]` 这个键只属于「id 为 null 时的占位查询」，而那一个是 `enabled: false` 的。

> 顺带说明：`['projects', {}]` 与 `['status']` 这两个**是能匹配成功的**（我实测过），所以失效入口本身的想法没错，错的是 project 这一条。

**实测证据**（两种，互为印证）：

1. 直接用 react-query 自己的匹配器与 QueryClient：

```
MATCH    projects({}) filter vs projects({category}) query
NO-MATCH project(0) filter vs project(5) query
invalidate 之后： ["project",5] isInvalidated=false / ["projects",{category:"personal"}] isInvalidated=true
```

2. 用 msw 把详情页整页渲染出来，走真实的「打开弹窗 → 改记录 → 保存」：

```
PATCH 提交的字段 -> {...,"record":"新记录：改过了",...}      ← 提交的是新值
详情接口被取了几次：保存前 1 保存后 1                        ← 保存后根本没有重新取数
正文里还有旧记录吗 -> true / 正文里有新记录吗 -> false      ← 页面停在旧值
```

**影响面**：详情页的 `useProject(validId)`（`ProjectDetailPage.tsx:22`）与弹窗自己的 `useProject(editingId)`（`ProjectFormDialog.tsx:48`）都用 `['project', id]`。清单页那一列因为走 `['projects', params]` 所以是好的——**只有详情页这一条路坏了**，也正好是最常改记录的地方。

**建议**：改成用前缀 `qc.invalidateQueries({ queryKey: ['project'] })`（或给 `queryKeys` 加一个 `projectAll: ['project']`）。同时建议补一条「保存后详情页显示新值」的组件测试——现在 3 个 web 测试文件都只渲染子组件（`StatusPanel` / `RecordView` / `RemoteRow`），mutation→invalidate 这条链路没有覆盖。

---

### P1-2 目录不在了 / 读不出来，被说成「不是 git 仓库」（实测复现）

**现象**：详情页的「git 状态」摘要行对 `missing` 与 `error` 两种状态都显示 **「不是 git 仓库」**。目录不在了的那种情况，同页顶部横幅还写着「这个目录不在了」——同一屏两句话打架；而 path_too_long / 读不出工作区这类 `error`，等于把一个「读不出来」说成了一个确定的错误结论。

**根因**：`StatusPanel` 为了把 dirty 降级而重算状态，喂给 `deriveStatus` 的 `isRepo` 来自状态对象；而 `missing` / `error` 这两种状态在 core 里 `isRepo === false`（`inspect/index.ts` 的 `blank()` / `unreadable()`），`deriveStatus` 的第一条判断就是：

```ts
// packages/core/src/types.ts:213
if (!input.isRepo) return 'not_a_repo'
```

于是 `missing` / `error` / `not_a_repo` 被压成同一个 `not_a_repo`，摘要行渲染的是 `textFor('not_a_repo', ...)` = 「不是 git 仓库」。真正的原因只留在 `title` 与下面那行小字里（`describe()` 会读 `error.message`），肉眼第一眼看到的是错的那句。

**实测证据**（渲染真实 `StatusPanel`，取 `data-testid="status-summary"` 的文本）：

```
MISSING     -> "不是 git 仓库"      （期望：目录不在了）
ERROR       -> "不是 git 仓库"      （期望：路径过长/读不出来…）
NOT_A_REPO  -> "不是 git 仓库"      （这一条是对的）
```

**建议**：`StatusPanel` 里不要用「重算出的 status」去渲染文案——`isRepo === false` 时直接用 `status.status`（`missing` / `not_a_repo` / `error`）走原来的分支，只对「是仓库」的那些状态做 dirty 降级。这与 README 里那条“归因错误会把人引向错误方向”的原则是同一个道理。

---

### P2-1 服务端「别拉」的闸与清单页显示的判决读的不是同一行（实测复现）

**现象**：判决落库之后，**清单页**显示的是「最近一条**远程结论**状态」的 detail；而 `runApply` 的服务端兜底 `lastVerdict` 读的是「最近**一条** detail」。只要后面又写进一行**没有 verdict 的检查**（最典型的是断网时的 `error` 行 —— 自动 fetch 每 30 分钟就会写一行），显示还说「别拉」，闸却已经放开了。

**实测证据**（往一个内存库里按真实顺序插两行，然后分别调产品代码的两个读法）：

```
服务端拦「别拉」读到的判决 -> null                (lastVerdict)
清单页显示的判决与时间   -> rewritten 2026-10-05T10:00:00.000Z   (listProjects → latestCheck)
```

第一行：`status='behind'`、`detail.verdict='rewritten'`；第二行：`status='error'`、detail 无 verdict（`analyzeUpdates` 失败时 `recommendation` 为 null，`recordUpdateCheck` 就不会写 verdict）。

**为什么值得修**：设计文档第 13 节第 20 条明确写了「前端禁勾只是建议，服务端也要有闸」。现在是**两处读不同的行、可以互相矛盾**——界面用一套依据、拦截用另一套依据。虽然 `pull --ff-only` + preflight 仍是硬保护（真分叉时拉不动，只会失败），但这道闸的语义已经不是它声称的那个了。

**建议**：把「读上次判决」与「读上次远程结论」收敛成同一个查询（都带 `status IN (远程结论)` 过滤），或者按 `project_id + detail LIKE '%verdict%'` 取最近一条有 verdict 的行。两条读法必须一致，否则「界面说别拉但服务端不拦」这种组合一定还会再出现。

---

### P2-2 设置页的数字输入框每次按键都 PATCH，显示值被弹回（实测复现）

**现象**：想把「git 超时」从 120000 改成 60000（清空后输入）。**敲下第一个字符，输入框就弹回 120000**。只能一个字符一个字符地用退格删（每删一次发一个 PATCH）。

**机制**（两条叠加）：

1. `Input` 的 `onChange` 直接 `update({ gitTimeoutMs: Number(...) })` → 每次按键一个 `PATCH /api/settings`（`SettingsPage.tsx:83-117`）。
2. 输入框是受控的、值来自服务端：`value={settings.gitTimeoutMs}`；而 `useSaveSettings` **只在成功时** `setQueryData`（`features/settings/queries.ts:25-27`）。中间值（如 `6`）不满足 `min(1000)` → 422 → mutation 状态变化触发重渲染 → React 把受控值写回旧值 → 用户敲的字符被吞掉。

**实测证据**（msw 模拟服务端的 422 行为）：

```
输入 "6" 之后输入框里的值   -> "120000"     ← 被弹回
删到 "12000" 之后输入框里的值 -> "12000"      ← 合法区间内的删除能生效
```

**建议**：给这三个数字字段加本地草稿 state（`onChange` 只改本地，`onBlur`/回车再 PATCH），或者至少 `type=number` 的输入做 debounce。顺带把 `min/max` 的提示做成前端校验（现在越界直接吃 422「参数有误」，用户看不出是哪个字段、哪个边界）。

---

### P2-3 标签名长度只在 `POST /api/tags` 上把关（实测复现）

同一份数据有两个写入口，校验却只有一份：

```ts
// packages/core/src/schemas.ts:42-48
export const createTagSchema = z.object({
  name: trimmed.min(1, '标签名不能为空').max(40, '标签名过长'),   // ← 有上限
  ...
})
// packages/core/src/schemas.ts:52-54
export const setProjectTagsSchema = z.object({
  tagNames: z.array(trimmed.min(1)).max(20),                     // ← 只限条数，不限每个的长度
})
```

而 `setProjectTags` 会「不存在的标签名按需创建」（`repos/tags.ts:21-37`），所以这条路能把任意长的名字写进 `tags`。

**实测证据**：

```
POST /api/tags 41 字符        -> 422
PUT /api/projects/:id/tags 200 字符 -> 200，库里 tags.name 长度 = 200
```

**建议**：把长度约束下沉成共享的一份（比如 core 导出 `tagNameSchema = trimmed.min(1).max(40)`，两处都用它）；`tags.name` 建议顺带在 schema 里加 `CHECK(length(name) <= 40)`（开发期不走迁移，直接改 `001_init` + 删库即可，符合不变量 14）。

---

### P2-4 批内重复路径会让整批导入失败，并报一个误导的错（实测复现）

`POST /api/projects/import` 的查重只查**库里有没有**（`pathExists`），不查**这一批里有没有**：

```
POST /api/projects/import { paths: ["D:/x/CaseRepo", "D:/x/caserepo"] }
  -> 409 {"code":"conflict","message":"这条记录已经存在了"}
  -> 库里的 projects 行数 before/after 都是 1（一条都没进）
```

原因是库层那条 `lower(path)` 部分唯一索引（`migrations.ts:62-63`）在事务里抛 `SQLITE_CONSTRAINT_UNIQUE`，整个事务回滚；`scan.ts` 那套 `skipped: {path, reason}` 机制（本来是用来「跳过已经在清单里的」）对它不起作用。对用户来说：点了「添加选中的 N 个」，什么都没加进去，还得到一句「这条记录已经存在了」——而他可能一个都还没加。

**可达性**：需要批内出现同一目录的两种拼写（大小写变体、8.3 短名、目录链接）。从 UI 走，最常见的是「用 junction/符号链接把同一个仓库挂到两个扫描目录下」+ 一次扫出来的两条分别导入（那种情况路径字符串不同，不会撞索引，但会**重复登记同一个物理仓库**——这是同一类问题的另一个面）。也不算难以触达。

**建议**：在 `scan.ts` 组装 `candidates` 时加一个 `Set`（`lower(absolutePath)`）做批内查重，撞上的走 `skipped` 而不是靠数据库报错；同时把「唯一约束冲突」在导入这条路上翻译成「有重复的目录，已跳过」而不是 409。

---

### P3 级问题（逐条）

**P3-1 lean 档的进程数，两处注释都写错了。**
`inspect/index.ts:4-11` 的表写「lean：每仓库 1 次 git」，`apps/server/src/lib/git.ts:116` 写「每仓库只剩 1 条 git 命令（算 ahead/behind）」；但 `inspect` 的 `readUpstreamTipCommit` 是**两档都读**的（`inspect/index.ts:159-165`，注释里还专门解释了为什么「作者上次更新」这一列必须两档都读）。所以 lean 实际是 2 条（`rev-list` + `log`）——`status-spawns.test.ts:19` 的注释自己也写着「lean：+ rev-list + log = **2 条**」。建议把两处表/注释改成 2，并说明这 2 条分别是什么（`bench-status.mjs` 的说明也依赖这个数字）。

**P3-2 源码注释里的 HTML 转义。**
`packages/core/src/git/runner.ts:18`：`/** 仓库目录，等价于 git -C &lt;dir&gt; */`。全仓只有这一处（`grep '&lt;|&gt;|&amp;'` 命中 1）。`scripts/check-encoding.mjs` 只查 U+FFFD，这种「看起来像被 HTML 洗过一遍」的痕迹查不出来。建议顺手改掉，并考虑给 `check:encoding` 加一条 `&lt;|&gt;|&amp;quot;` 的告警（源码注释里本来不该出现这些实体）。

**P3-3 三处指向不存在的东西。**
- `packages/core/src/git/inspect/via-lib.ts:9`：「见 `packages/core/test/git/inspect-lib.test.ts`」——这个文件不存在（core 的 git 测试是 analyze/command-log/errors/log/pull/recommend/scan/scheduler*/status*/upstream-gone）。那条注释声称的「探针实测边界」（不读对象、upstreamGone 只判引用）在仓库里**没有对应的测试**，属于「引用了一个不存在的证据」。建议要么补测，要么把注释改成描述实际覆盖它的测试。
- `apps/server/src/repos/projects.ts:167`：「库层还有一条 `lower(path)` 的部分唯一索引兜底（**迁移 003**）」——`migrations.ts` 只有 `001_init` / `002_settings`，这条索引在 001 里。编号是错的。
- `apps/web/vitest.config.ts:21-22`：`server: { deps: { inline: ['@tomplum/react-git-log'] } }` 与 `css: true` 的注释都还在讲提交图那个已删除的依赖；`docs/superpowers/specs/...design.md` 第 13 节第 7 条也仍然写着「提交图最终**用了** `@tomplum/react-git-log`」——而它在后续提交里已被撤掉（`STATUS.md` 的「待决定的事」才记了这个反转）。三处残留建议一起清一遍。

**P3-4 `GIT_PROGRESS` 不是 git 的环境变量。**
`packages/core/src/git/pull.ts:43` 给 pull 传了 `env: { GIT_PROGRESS: '0' }`，意图显然是「别让进度条污染输出」。实测读 git 自己的二进制：`GIT_PROGRESS_DELAY` 在、`GIT_PROGRESS` 不在（`mingw64/bin/git.exe` 与 `libexec/git-core/git.exe`、`git-remote-https.exe` 三个都是同一结果），git 文档里的相关变量也只有 `GIT_PROGRESS_DELAY`。所以这一行是无效配置（无害：stdout 不是 tty，git 本来也不出进度条）。要么删掉，要么改用 `GIT_PROGRESS_DELAY`。

**P3-5 `update_checks` 只写不删。**
全仓没有任何 `DELETE FROM update_checks`（只有 `ON DELETE CASCADE` 跟着项目走）。写入点有两处：手动/批量检查，以及**自动 fetch 每 30 分钟一轮、每个仓库一行**（`auto-fetch.ts:92`）。按 48 行/天/仓库算，50 个仓库一年约 87 万行（每行含一段 JSON detail）。清单页那条查询虽然用了 `MAX(id) GROUP BY project_id`（有 `(project_id, checked_at DESC)` 索引可用），但表本身会一直长。建议加一条保留策略（比如每仓库只留最近 N 条 / 或只留「远程结论」行 + 判决基线行），反正 `STATUS.md` 也还没想好要怎么利用这份历史。

**P3-6 `POST /api/auto-fetch` 是同步等整轮跑完，而这一轮是严格串行的。**
`doAutoFetch` 用 `for … await` 逐个仓库跑（`auto-fetch.ts:82-99`），**并发上限设置对它无效**；`POST /api/auto-fetch`（`diagnostics.ts:42-44`）会一直挂到整轮结束才返回。手动「现在跑一轮」在仓库多的时候会让一个 HTTP 请求挂几分钟，而且没有任何进度——check/apply 那两条路都用了「POST 起任务 + SSE」的模式，这里不一致。建议要么复用任务模式，要么至少把循环改成受 scheduler 限制的并发。

**P3-7 `runCheck` 在拿到并发许可前就把所有行标成「检查中…」。**
`targets.map(async (t) => { markRunning(task, t.id); ... })`（`updates.ts:170-185`）：async 函数体会同步执行到第一个 await，所以 200 个仓库会**同时**变成 running 并发 200 个 SSE 事件，而真正在跑的只有 4 个。进度计数（`done/total`）是对的，但每行都显示「检查中…」是不准确的。建议把 `markRunning` 挪到 `analyze()` 真正开始执行的位置（或由 core 通过回调在拿到许可后通知）。

**P3-8 `/projects/:id/log` 为了两个字段跑一次 full+fresh 状态读取。**
`routes/git.ts:56-76`：先 `await repoStatus(path, { fresh: true })` 只为拿 `isRepo` 与 `branch`，而 full 档会读工作区、最后提交、并算推荐（3–4 条 git 进程，`fresh` 还绕开了缓存）。这个接口一阶段界面不显示（留给二阶段 Agent），但第一次真有人用时会明显慢。建议改成 `readRepoFacts`（库，0 进程）或 lean 档。

**P3-9 「编辑资料」弹窗的表单重置依赖整个 `editing` 对象。**
`ProjectFormDialog.tsx:58-75` 的 `useEffect` deps 是 `[formOpen, editingId, editing]`；`editing` 是 query 的 data 对象，**每次重取都是新引用**。弹窗开着的时候只要该 query 重取一次（别的 mutation 失效、或 `staleTime` 到期后重挂载），用户没保存的输入就会被服务端旧值覆盖。建议 deps 收成 `[formOpen, editingId]`，用「打开时取一次快照」的语义（加一个 `initializedFor` ref）。这也是 P1-1 修好之后**风险会变高**的一处——失效一旦生效，重取就会变频繁。

**P3-10 一致性与死代码（一次说完）**
- `apps/web/src/lib/format.ts:30` 的 `hostOf` 没有任何引用（全仓 grep 只命中定义处）。
- `createProjectSchema.path` 只有 `min(1)`，而 `updateProjectSchema.path` 有 `max(400)`、`scanSchema.dir` 有 `max(400)`（`schemas.ts:8` / `:22` / `routes/scan.ts:18`）。同一个字段两条路的上限不一致。
- `packages/core/tsconfig.json` 同时写 `"noEmit": true` 与 `"outDir": "dist"`（`outDir` 因此无意义）；`packages/core` 与 `apps/server` 的 `build` 脚本因此**什么都不产出**，`pnpm build` 实际只构建了 web。不是错误，但「build」这个词在这里是误导。
- `apps/server/src/lib/git.ts:215-218` 的 `getRemoteUrl` 先 `scheduler.schedule(path, …)` 再调 core 的 `getRemoteUrl`，**故意没把 scheduler 传下去**——如果谁「顺手补齐」把 scheduler 传进去，就会变成同 key 的 schedule 里再 schedule，直接自锁（`scheduler.ts:56` 的注释专门警告过这件事）。建议在调用处写死一句注释，或者让 core 那层只保留一个不做调度的内部函数，避免这个陷阱被人踩。
- `packages/core/package.json` 的 `exports` 里 `./types` 没人引用（README 自己注明了），`packages/core/src/git/index.ts` 也没有导出 `readIsAncestor` / `readHasCommonAncestor` / `readRecommendation`（`recommend.ts` 里这三个函数目前只有内部与测试在用）。属于可以留着的东西，列在这里只是标注一下「当前无人用」。

---

## 3. 我查过、但**没有**问题的部分（免得下次重复查）

这些是按审计直觉最该出事的地方，我逐条看过/跑过，结论是站得住的：

1. **`pull` 的安全闸**：preflight 只用本地事实（不是仓库 / 空仓库 / 脏 / detached），读不出工作区时**不往下走**（返回 skipped 而不是当成干净）；不用旧的 ahead/behind 判「没东西可拉」，交给 `pull --ff-only` 自己 fetch。核心不变量 1、4 成立。
2. **同仓库串行 / 跨仓库并发**：server 侧只有一个 `Scheduler` 实例，`analyze` / `pull` / `repoStatus` / `scan` / `getRemoteUrl` 都显式传它；core 里 `schedule` 不可重入这条约束在 server 的调用方式下没有被违反（唯一「差一点违反」的就是上面 P3-10 里说的 `getRemoteUrl`）。
3. **判决判据本身**：`applyVerdict` 是纯函数，只吃调用方给的事实；`rewritten` 优先于 `unrelated` 优先于分叉；「本地没见过的 force push 看不出来」这个限制是**诚实写明**并有专门用例钉着的。基线在 fetch **之前**读（`log.ts:143` vs `:146`）——顺序是对的。
4. **状态机与新鲜度**：`deriveStatus` 的优先级、`REMOTE_CHECK_STATUSES` 只收真正问到远程的四种状态、`>12h` 降级措辞、lean/full 两档缓存不共用、`isRemoteCheckStatus` 前后端同一份——这些都对，且都有测试。
5. **导入的原子性**：`db.transaction` 包住整批，`nextSortOrder` 在事务内递增（不会给同一批里的多个项目发同一个 sort_order）。
6. **SSE**：事件缓冲 + 游标的做法能覆盖「先启动后订阅」；客户端断开时 `clientGone` 让 150ms 轮询退出；`forceCloseConnections: true` 解决了 `app.close()` 被 SSE 挂住的问题；`task` 的 TTL 规则（不动 running、从 finishedAt 起算）是对的。
7. **路由/文档对账测试**：`docs-api-drift.test.ts` 的抽取正则与 README/设计文档确实能对上（README 里那段 API 表我逐条比对过源码注册，一致）。
8. **路径处理**：UNC / `\\?\` / 驱动器根 / `~` / 大小写唯一索引这几处都考虑过了，`pathExists` 用 `lower(path)`、库层再加一条部分唯一索引兜底。
9. **前端订阅粒度**：zustand 逐字段订阅 + `useShallow` 的 `useSelectedIds`，整店订阅被打掉这件事有 Profiler 测试钉着。

---

## 4. 未能证实 / 建议进一步确认

1. **P2-4 的可达性**：我只能证明「API 层面能构造出这个失败」，没有在 UI 里造出 junction/短名场景走一遍。判断为「真实但需要一点巧合」。
2. **P2-2 用真实浏览器复现**：我的证据来自 jsdom + msw 的行为模拟（React 受控输入的重置逻辑在 jsdom 与浏览器里一致，但严格说没上浏览器）。`docs/STATUS.md` 里提到的那种「用 pwsh 验中文接口会误报」的坑我这次没踩——所有中文断言的比对都在 node 里做。
3. **`update_checks` 增长的量级**：我按「48 行/天/仓库」估算，没有实测一个跑了几周的真实库（本机 `data/git-nest.db` 只有 4KB、WAL 300KB，说明它还没被长期使用过）。
4. **`scanDirectory` 的递归是同步 `readdirSync`**（`scan.ts:32-54`）：在 depth=3、目录很大的时候会阻塞事件循环。我没有量到「多大算大」，只标注为性能观察，没有列进问题表。

---

## 5. 附录：每条发现的复现方式

> 下面这些脚本是我审计时**临时**写、跑完即删的（仓库里不留痕迹）。命令都在仓库根目录跑。

**(a) 失效键匹配（P1-1）** —— 用 react-query 自己的匹配器，不需要浏览器：

```js
// apps/web/ 下执行，路径按 pnpm 实际的 .pnpm 目录调整
import { matchQuery, QueryClient } from '@tanstack/query-core'
console.log(matchQuery({ queryKey: ['project', 0] }, { queryKey: ['project', 5] })) // false
const qc = new QueryClient()
qc.setQueryData(['project', 5], { id: 5 })
await qc.invalidateQueries({ queryKey: ['project', 0] })
console.log(qc.getQueryState(['project', 5])?.isInvalidated) // false
```

**(b) 详情页保存后不刷新（P1-1）** —— vitest + msw（`apps/web` 的 setup 已经装好了 msw 与 FakeEventSource）：mock `GET /api/projects/5`、`PATCH /api/projects/5`、`GET /api/projects/5/status`、`GET /api/tags`，用 `MemoryRouter initialEntries=['/projects/5']` 渲染 `ProjectDetailPage`，点「编辑资料」→ 改 textarea → 点「保存改动」，然后断言页面上出现新记录、并数 `GET /api/projects/5` 的次数。当前结果：次数不变、页面仍是旧记录。

**(c) 「不是 git 仓库」（P1-2）** —— 直接渲染 `StatusPanel`（从 `@/pages/ProjectDetailPage` 导出）并传三种状态：

```tsx
render(<StatusPanel status={{...blank, status:'missing', error:{kind:'missing',message:'目录不在了'}}} ... />)
screen.getByTestId('status-summary').textContent  // "不是 git 仓库"
```

**(d) 判决与服务端闸读不同行（P2-1）** —— `openDatabase(':memory:')`，插一行 `behind + detail.verdict='rewritten'`、再插一行 `error`（detail 无 verdict），然后：

```ts
lastVerdict(db, id)                                  // null          （闸松了）
listProjects(db).find(p => p.id === id).latestCheck  // rewritten     （界面还写着别拉）
```

**(e) 标签长度（P2-3）** —— `buildApp({db: openDatabase(':memory:'), logger:false}).app.inject(...)`：`POST /api/tags {name:'x'.repeat(41)}` → 422；先建一个项目，再 `PUT /api/projects/:id/tags {tagNames:['y'.repeat(200)]}` → 200，`SELECT length(name) FROM tags` → 200。

**(f) 批内重复导入（P2-4）** —— `POST /api/projects/import {paths:['…/CaseRepo','…/caserepo']}` → 409；前后 `SELECT COUNT(*) FROM projects` 不变。

**(g) 设置页输入框（P2-2）** —— 渲染 `SettingsPage`（mock `GET /api/settings` = 120000、`PATCH` 对 <1000 返回 422），`fireEvent.change(input, {target:{value:'6'}})`，等 200ms 后读 `input.value` → `"120000"`。

**(h) `GIT_PROGRESS`（P3-4）**：

```powershell
$s = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes('D:\Environment\Git\mingw64\bin\git.exe'))
[regex]::IsMatch($s, 'GIT_PROGRESS_DELAY(?![_A-Z0-9])')  # True
[regex]::IsMatch($s, 'GIT_PROGRESS(?![_A-Z0-9])')        # False
```

---

## 6. 建议的修复顺序（按性价比）

1. **P1-1**（一行改动：失效键改前缀）+ 补一条「保存后详情页显示新值」的组件测试。
2. **P1-2**（`StatusPanel` 里 `isRepo === false` 时直接用原状态）+ 补 missing/error 两个用例。
3. **P2-3**、**P2-4**（都是「把散在两处的规则收成一处」的小改动，且能顺手补测）。
4. **P2-1**（统一两处读法；这条要动 repo 层的查询，建议同时想清楚 `update_checks` 的保留策略，见 P3-5）。
5. **P2-2**（设置页三个字段加本地草稿）。修完顺手把 P3-9 的 deps 一起收掉，因为失效生效后重取会变频繁。
6. **P3 里的一次性清理**：注释（P3-1/2/3）、`GIT_PROGRESS`（P3-4）、死代码与 tsconfig（P3-10）。
7. **P3-5/6/7/8** 属于「规模上来之后才会难受」的，可以排到最后，但 P3-5（表只增不减）建议在真的开始长期用之前处理掉。

---

## 7. 一句话总评

代码的组织方式、不可变约束的显式化程度（每条不变量都有编号、都有注释解释「为什么」、大多有测试钉着）明显高于一般个人项目，`pull`/判决/状态机这几处**最危险的地方反而是最结实的**。这次找出来的问题集中在「**写完之后的收尾**」：保存了但不刷新、查过了但两处读的不是同一行、同一条规则只在一个入口把关、注释与实现各说各话。这些都不影响「不自动更新」这条底线，但影响用户对工具的信任——尤其 P1-1，它会让用户以为自己的记录丢了。
