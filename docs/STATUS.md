# git-nest 交接文档

> 新会话先读这个，再读 `README.md`（怎么跑、API、技术栈），最后读
> `docs/superpowers/specs/2026-06-20-git-nest-design.md`（设计 + 第 13 节的实现差异）。
>
> 最后更新：2026-10-01，代码状态见 `git log`，工作区干净。

## 一句话现状

git-nest 已完成 M1–M5 五个里程碑，功能与设计文档对齐（含 10 条已记录的差异）。
2026-10 做过一轮全量质量审计（`docs/AUDIT-2026-10-01.md`）并修掉其中的真实缺陷：
提交图换回设计文档指定的 `@tomplum/react-git-log`（自研泳道图有车道泄漏）、
PATCH 部分更新不再静默清空字段、批量路径恢复「同仓库串行」、失败不再被报成
「已是最新」等。**唯一没做的是设计文档第 10 节的 Agent 预留**（本来就说本期不实现）。

> 测试数量会随每次改动变化，别把它写进结论里 —— 跑 `pnpm test` 看实际数字。

## 里程碑与提交

| 里程碑 | 内容 | 提交 |
|---|---|---|
| M1 | 骨架：monorepo、SQLite、项目 CRUD、清单/详情/设置页 | `020059e` |
| M2 | git 执行层（status/log/pull/scan/scheduler/错误归因）、状态列、提交图 | `5559acf` |
| M3 | 批量检查更新 → 勾选 → ff-only 更新 + SSE 进度 | `7d1dbd2` |
| M4 | 目录扫描导入 | `d0d73e4` |
| M5 | 错误归因打磨 + Windows 兼容验证 | `c714b22` |
| 补 | 补上文档漏掉的三条（检查列 / 确认阈值 / 顶栏扫描目录） | `fa9ca11` |
| 补 | **状态不再说没有依据的话** + 补齐详情页 tag 管理、扫描区移除管理 | `52c4f19` |
| 补 | MSW 组件测试（第 9 节要求） | `1068283` |
| 文档 | 设计文档第 13 节：实现与文档的 10 条差异 | `e90fce1` |
| 质量 | 全量审计 + 逐条修复（详见 `docs/AUDIT-2026-10-01.md`） | `95380e2` 起 |

## 怎么跑 / 怎么验

```bash
pnpm install          # 见「坑」里的 pnpm 12 软链问题
pnpm dev              # server :5174 + web :5173
pnpm typecheck        # 三个包一起 tsc --noEmit
pnpm test             # vitest（core / server / web 三个 project）
pnpm build            # 只构建 web
pnpm bench:status     # lean/full 两档的墙钟时间与进程数（需要本机有真仓库）
pnpm check:encoding   # 扫 U+FFFD 坏字符（提交前跑）
```

数据库在 `data/git-nest.db`（已 gitignore），删掉即回到空清单。
可覆盖的环境变量：`GIT_NEST_DB` / `GIT_NEST_PORT` / `GIT_NEST_HOST` / `GIT_NEST_CORS`
（web 侧还有 `GIT_NEST_API`，见 README 的表）。
**超时不是环境变量**：它是设置表里的 `gitTimeoutMs`（默认 120s），在设置页改。

> `apps/server/test/docs-api-drift.test.ts` 会检查这三份文档里写的 API 端点与
> `GIT_NEST_*` 变量是否真在代码里存在——写错了测试就红，不用靠人肉对账。

## 代码地图（改东西先看这里）

```
packages/core/                 纯能力层，浏览器打不到（无 UI / 无 HTTP 依赖）
├── src/git/runner.ts          ★ 所有 git 调用的唯一出口（-C、超时、凭证、longpaths）
├── src/git/scheduler.ts       同仓库串行 + 跨仓库并发上限 4（不可重入！）
├── src/git/inspect/           ★ 读状态的两档与两条路（列表页 vs 详情页）
│   ├── types.ts               事实的形状 + 「每条事实只有一个提供方」的约定
│   ├── via-lib.ts             ref/config 走 isomorphic-git（不 spawn 进程）
│   ├── via-cli.ts             工作区 / ahead-behind / 祖先关系 / 最后提交走真 git
│   ├── recommend.ts           ★ 推不推荐更新：读事实（CLI）+ 下判决（纯函数）
│   └── index.ts               lean（列表页，1 进程）/ full（详情页，4 进程）
├── src/git/status.ts          12 种状态分支 + 状态机优先级（对外那层壳）
├── src/git/log.ts             analyzeUpdates：fetch 后比差异 + 出推荐结论
├── src/git/pull.ts            只允许 --ff-only；前置检查 + 失败后归因
├── src/git/scan.ts            扫一层子目录找仓库
├── src/git/errors.ts          错误分类（网络/认证/锁/路径过长/找不到远程…）
├── bench-status.mjs           量 lean/full 两档的墙钟时间与进程数（真仓库）
├── src/schemas.ts             zod：前后端共用同一份校验
└── test/git/*.test.ts         全部用临时目录里真实 git 仓库，不 mock git

scripts/check-encoding.mjs    扫 U+FFFD 坏字符（中文文件偶尔会混进去）

apps/server/
├── src/db/migrations.ts       002 = settings 表（迁移内嵌在代码里）
├── src/lib/git.ts             git 层在 server 侧的入口（超时/并发读设置 + 3 秒短缓存）
├── src/lib/settings.ts        键值设置，支持 JSON 数组值
├── src/lib/tasks.ts           批量任务 + 事件缓冲（缓冲数组+游标，不是发布订阅）
├── src/routes/                index(projects/tags) + git / updates / scan / settings
└── test/*.test.ts             Fastify inject（app.inject，不起真端口）

apps/web/src/
├── features/status/           状态列。★ freshness 逻辑在这里（措辞按新鲜度降级）
├── features/updates/          更新报告：宽版弹窗，check → 报告 → 勾选 → apply → 汇总
├── features/gitgraph/         （已删）一阶段界面不再有提交图，见下方「待决定的事」
├── features/settings/         扫描目录 + 标签 + 参数
├── features/projects/         清单页、项目表单、tag 选择器
├── store/ui.ts                zustand：筛选 / 选中 / 弹窗
└── test/                      msw setup + 假 EventSource
```

## 核心不变量（改代码前先确认没破坏）

1. **绝不自动更新。** 检查只 fetch（不动工作区），更新只由用户勾选后触发，且只 `--ff-only`。
   禁止 `reset --hard` / `clean` / `push` / 任何历史重写。
2. **git 实时状态不落库**，每次现查（server 侧 3 秒短缓存，`?fresh=true` 绕开）。
   落库的下次打开就是旧数据，反而更危险。
3. **同仓库串行、跨仓库并发上限 4**；`Scheduler.schedule` 对同一 key 不可重入。
4. **勾选判据是判决的 `canPull`，不是 `status === 'behind'`。** 作者 force push 改写历史
   （`rewritten`）或删库重建（`unrelated`）时，本地 refs 看到的**恰恰就是** `behind`：
   只看 status 等于邀请用户去点一个「勾了也没用」的仓库，而那两种正是设计文档第 1 节
   要防的场景。dirty / diverged / detached / 无上游 同样勾不了。
   **这道闸前端与服务端各有一道**：前端禁勾只是建议，`runApply` 会再读一次
   `update_checks.detail` 里存的判决，是「别拉」就直接跳过（且不写新的检查行——
   那一步没读到任何新事实）。
5. **状态措辞按新鲜度降级**：状态接口不联网，「已是最新」在没依据时是失真的。
   从没查过 → 「没查过远程」且不给颜色；>12h → 「上次看是最新」；纯本地状态不受影响。
6. **本地绝对路径只存本机 SQLite**，不进任何会被提交的文件。
7. **core 有两个入口**：`@git-nest/core`（类型+zod，浏览器安全）、
   `@git-nest/core/git`（依赖 node:child_process，只能 node 侧引）。
   在 barrel 里 `export *` git 层会让浏览器包直接白屏。
   同理，`isomorphic-git` 只允许在 `src/git/inspect/via-lib.ts` 里引——
   那个文件挂在 `/git` 入口下，浏览器侧碰不到。
8. **列表页与详情页不共用状态缓存**。列表页走 lean 档，`dirty` 恒为 false、
   `lastCommit` 恒为 null（列表列不显示这两条）；详情页走 full 档，两者都真读。
   混用缓存会让详情页在几秒内谎报「干净」——而脏标记是第 1 条那个安全闸的判据。
   同理，`pull` 的前置检查只认 full 档。
9. **「推不推荐更新」只在真正问过远程之后才算**，而且结论**要落库**
   （`update_checks.detail` 里的 `verdict`）。清单页那条列读的是**上次检查的结论**，
   不是现算的——现算要先 fetch，而列表是纯本地读，拿旧 refs 算出来的正是
   「没有依据的肯定」。没查过就显示「没查过」，绝不给绿色的「可更新」。
10. **判「作者改写历史」必须靠基线**（上次见到的上游 SHA）。只看本地 refs 是
   判不出来的：force push 掉本地从没读过的提交时，本地 HEAD 仍是新历史的祖先，
   git 自己也会正常快进。基线来自两处，前者优先：`update_checks` 里记的、
   或 fetch 前本地 refs 指的那个（一次 pull 会写一条没有 SHA 的新记录，
   所以需要本地 ref 兜底）。**读基线必须在 fetch 之前**。
11. **自动做的事必须留痕。** 自动 fetch 会自己联网，所以每一条 git 命令都进
   命令日志（`runner.ts` 的 `recentCommands`，带 `label` 标明发起者）。
   新增任何「自己会跑」的后台行为，都要能通过 `GET /api/commands` 查到。
12. **元数据只有一条线：能从仓库自己读出来的不存，只有用户知道的才存。**
   摘要是前者（README 现场读，只有扫描预览里出现、不落库），记录是后者
   （`projects.record` **一个文本框**，链接写在正文里）。不要因为「结构化更整齐」
   再拆出 notes 表、来源链接列、`kind` 字段那一类东西——那三样已经因为同一个原因
   撤过一次，见设计文档第 13 节第 19 条。
13. **一个编辑器，不是两个门。** 项目的可写字段（名称/路径/分类/标签/记录）全部只在
   「编辑资料」弹窗里改；页面各处只做展示与只读渲染（记录在详情页只读，正文里的
   URL 渲染成可点链接）。别再往页面或标签行旁边挂「快捷编辑」按钮——那不是捷径，
   是第二个入口，已经因此返工两次（标签行内编辑器、详情页的记录文本框）。

## 待用户决定的事

- **提交图要不要回来？** 一阶段从界面撤掉了（`@tomplum/react-git-log` 是个不虚拟化的
  HTML 网格，为 120 条提交就渲染出成百上千个节点；依赖也已移除）。
  后端接口 `GET /api/projects/:id/log` 与 core 的 `getLog` **保留着**，留给二阶段 Agent
  解析提交历史。要在界面上重新显示，得先解决虚拟化，别再直接塞回详情页。
- **`update_checks` 的历史要不要利用起来？**（比如「这个仓库近 30 天更新了 5 次」）
  目前它只存不用，外加给「推不推荐更新」当基线与结论载体。
- **Agent 接入**（设计文档第 10 节）：见上面那条。

## 这个环境踩过的坑（省新会话的时间）

**会毁掉工作区的**

1. `taskkill /F /IM node.exe` 会把跑着 agent 的 node 一起杀掉（我犯过一次，
   终端直接断掉）。正确做法：按端口找 PID 再杀
   `netstat -ano | grep :5174 | grep LISTENING` → `taskkill /F /PID <pid>`。
2. 用 heredoc 跑 `python - <<'EOF'` 改仓库里的文件**会静默失败**（不报错但也没写进去）。
   改文件一律用编辑/写文件的工具，别用 python heredoc。

**git 行为层面的（都写进 README「踩过的坑」了）**

3. **`-c credential.helper=` 不能少。** 只设 `GIT_TERMINAL_PROMPT=0` 挡不住 git 卡在
   凭证链上（实测挂 8 秒以上无输出），一个私有仓库就能把整批检查拖到 120 秒超时。
4. **Windows 超过约 260 字符的路径 git 进不去**（`core.longpaths` 救不了最初的 chdir）。
   现在直接报 `path_too_long` 并说清怎么办。
5. **目录要用 `git -C <dir>` 而不是 spawn 的 `cwd`**，否则长路径直接 ENOENT。
6. **`pullRepo` 的前置检查只能用本地事实**（不是仓库/空仓库/脏/detached），
   不能拿旧的 ahead/behind 判「没东西可拉」——那个数字来自上次 fetch，
   会把真有更新的仓库误报成「已是最新」而且根本不执行 pull。

**工程环境层面**

7. pnpm 12 会把 `node_modules/.pnpm/` 里的软链指到不存在的目录，表现为某个包的
   `node_modules/.bin` 少了命令（比如 vitest 找不到）。`pnpm dedupe` 能修好。
   `pnpm install` 偶尔会「假装 up-to-date」什么都不做，删 `node_modules/.modules.yaml` 也没用，
   全量 `rm -rf node_modules && pnpm install` 才行（store 有硬链接，很快）。
8. `better-sqlite3` 要跑安装脚本，pnpm 10+ 默认拦截，已在 `pnpm-workspace.yaml` 的
   `allowBuilds` 放行（**pnpm 12 的键名就叫这个**；pnpm 10/11 时代是
   `onlyBuiltDependencies`，旧键在 12 里已合并、写了不生效）；换机器报
   `ERR_PNPM_IGNORED_BUILDS` 就 `pnpm approve-builds --all`。
9. msw 3.x 里 `server.listen` 的选项叫 `onUnhandledFrame`（2.x 是 `onUnhandledRequest`）。
10. 验证 UI 用 `playwright-cli`（全局命令）：`open` / `snapshot` / `find` / `screenshot`。
    起服务前记得先 `rm -rf apps/web/node_modules/.vite` 清 HMR 缓存，
    否则改完组件会白屏（报 "does not provide an export named ..."）。
11. 写中文文件偶尔会混进 U+FFFD 坏字符。提交前跑 `pnpm check:encoding`
    （scripts/check-encoding.mjs）扫一遍，比肉眼可靠。

## 已知的非 bug 现象

- 批量检查时**只显示被检查过的仓库**：personal 分类默认跳过，面板顶部会说明跳过了谁。
- 一个仓库同时被两个 `pnpm dev` 占用端口时会启动失败——先按上面第 1 条杀干净。
- 早期跑全量测试时观察到偶发失败（analyze 的 tag 用例、pull 的 ff-only 用例）。
  **已定位并修掉**：根因是 `packages/core` 跑真实 git 集成测试却没有 vitest 配置、
  继承默认 5s 超时——并行跑全套时 git 进程争 IO，单例能从 2.3s 拖到 5s+，
  于是随机超时。补上 `packages/core/vitest.config.ts`（60s）后全量稳定。
  教训：这类「单独跑绿、并发跑红」先看超时配置，别急着怀疑竞态。

## 测试怎么组织

- `packages/core/test/helpers/repo.ts` 提供 `git` / `tempDir` / `write` / `commit` /
  `initRepo` / `initClone` / `cleanup`，所有 git 集成测试都用它造真实仓库，**不 mock git**。
- `apps/server/test/*.test.ts` 用 `app.inject`（不起真端口），内存库 `openDatabase(':memory:')`。
  批量任务用 `waitForTask()` 轮询快照——SSE 在测试里不测（web 侧用假 EventSource 覆盖）。
- `apps/web/src/**/*.test.tsx` 用 msw；`onUnhandledFrame: 'error'` 保证没 mock 的请求会失败，
  避免「测试通过但压根没打到接口」的假绿。
- `apps/server/test/docs-api-drift.test.ts` 拿文档里写的 API 端点、`GIT_NEST_*` 变量
  和源码对账——改路由却忘了改文档时会红。
- 测试里造仓库很慢（Windows 上每条 git 命令几百毫秒），所以 core 与 server 都把
  vitest 超时放宽到 60s（core 在 `vitest.config.ts`，server 在各测试文件里
  `vi.setConfig({ testTimeout: 60_000 })`）。全量约 40–60 秒。
