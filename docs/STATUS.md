# git-nest 交接文档

> 新会话先读这个，再读 `README.md`（怎么跑、API、技术栈），最后读
> `docs/superpowers/specs/2026-06-20-git-nest-design.md`（设计 + 第 13 节的实现差异）。
>
> 最后更新：2026-10-01，代码状态 `e90fce1`，工作区干净。

## 一句话现状

git-nest 已完成 M1–M5 五个里程碑，功能与设计文档对齐（含 10 条已记录的差异），
141 个测试全绿。**唯一没做的是设计文档第 10 节的 Agent 预留**（本来就说本期不实现）。

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

## 怎么跑 / 怎么验

```bash
pnpm install          # 见「坑」里的 pnpm 12 软链问题
pnpm dev              # server :5174 + web :5173
pnpm typecheck        # 三个包一起 tsc --noEmit
pnpm test             # 141 个用例，15 个文件
pnpm build            # 只构建 web
pnpm check:encoding   # 扫 U+FFFD 坏字符（提交前跑）
```

数据库在 `data/git-nest.db`（已 gitignore），删掉即回到空清单。
`GIT_NEST_DB` / `GIT_NEST_PORT` / `GIT_NEST_GIT_TIMEOUT` 可覆盖。

## 代码地图（改东西先看这里）

```
packages/core/                 纯能力层，浏览器打不到（无 UI / 无 HTTP 依赖）
├── src/git/runner.ts          ★ 所有 git 调用的唯一出口（-C、超时、凭证、longpaths）
├── src/git/scheduler.ts       同仓库串行 + 跨仓库并发上限 4（不可重入！）
├── src/git/status.ts          12 种状态分支 + 状态机优先级
├── src/git/log.ts             提交图数据 + analyzeUpdates（fetch 后比差异）
├── src/git/pull.ts            只允许 --ff-only；前置检查 + 失败后归因
├── src/git/scan.ts            扫一层子目录找仓库
├── src/git/errors.ts          错误分类（网络/认证/锁/路径过长/找不到远程…）
├── src/schemas.ts             zod：前后端共用同一份校验
└── test/git/*.test.ts         全部用临时目录里真实 git 仓库，不 mock git

scripts/check-encoding.mjs    扫 U+FFFD 坏字符（中文文件偶尔会混进去）

apps/server/
├── src/db/migrations.ts       002 = settings 表（迁移内嵌在代码里）
├── src/lib/git.ts             git 层在 server 侧的入口（超时/并发读设置 + 3 秒短缓存）
├── src/lib/settings.ts        键值设置，支持 JSON 数组值
├── src/lib/tasks.ts           批量任务 + 事件缓冲（缓冲数组+游标，不是发布订阅）
├── src/routes/                projects / notes / tags / git / updates / scan / settings
└── test/*.test.ts             Fastify inject（app.inject，不起真端口）

apps/web/src/
├── features/status/           状态列。★ freshness 逻辑在这里（措辞按新鲜度降级）
├── features/updates/          更新面板：check → 报告 → 勾选 → apply → 汇总
├── features/gitgraph/         自研泳道提交图（layout.ts 是纯函数，layout.test.ts 覆盖）
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
4. **只有 `behind` 状态能勾选更新**：dirty / diverged / detached / 无上游 勾了也没用。
5. **状态措辞按新鲜度降级**：状态接口不联网，「已是最新」在没依据时是失真的。
   从没查过 → 「没查过远程」且不给颜色；>12h → 「上次看是最新」；纯本地状态不受影响。
6. **本地绝对路径只存本机 SQLite**，不进任何会被提交的文件。
7. **core 有两个入口**：`@git-nest/core`（类型+zod，浏览器安全）、
   `@git-nest/core/git`（依赖 node:child_process，只能 node 侧引）。
   在 barrel 里 `export *` git 层会让浏览器包直接白屏。

## 待用户决定的事

- **要不要后台自动 fetch？** 现在是「点检查才联网」，符合「绝不自动」的底线，
  代价是新克隆的仓库在你手动检查前一直显示「没查过远程」。
  另一个选项是打开页面空闲 30 秒后静默 fetch（不改工作区），
  权衡是「不意外联网」vs「数字总是新鲜」。**目前没做，等用户拍板。**
- **Agent 接入**（设计文档第 10 节）：`core` 无 UI/HTTP 依赖、API 覆盖全部用户操作，
  Agent 的能力上限 = 用户的能力上限，没有特权后门。可先做「哪些项目值得关注」的分析。
- 提交图换 react-git-log（接口已隔离在 `features/gitgraph/` 一个组件里）。
- `update_checks` 的历史趋势利用（数据存了三个月，一直只存不用）。

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
   `onlyBuiltDependencies` 放行；换机器报 `ERR_PNPM_IGNORED_BUILDS` 就 `pnpm approve-builds --all`。
9. msw 3.x 里 `server.listen` 的选项叫 `onUnhandledFrame`（2.x 是 `onUnhandledRequest`）。
10. 验证 UI 用 `playwright-cli`（全局命令）：`open` / `snapshot` / `find` / `screenshot`。
    起服务前记得先 `rm -rf apps/web/node_modules/.vite` 清 HMR 缓存，
    否则改完组件会白屏（报 "does not provide an export named ..."）。
11. 写中文文件偶尔会混进 U+FFFD 坏字符。提交前跑 `pnpm check:encoding`
    （scripts/check-encoding.mjs）扫一遍，比肉眼可靠。

## 已知的非 bug 现象

- 批量检查时**只显示被检查过的仓库**：personal 分类默认跳过，面板顶部会说明跳过了谁。
- 一个仓库同时被两个 `pnpm dev` 占用端口时会启动失败——先按上面第 1 条杀干净。
- 早期跑全量测试时观察到一次偶发失败（analyze 的 tag 用例、pull 的 ff-only 用例，
  都涉及跨进程 git 状态），之后连跑 3 次 130/130。判断是 Windows 环境抖动而非逻辑竞态，
  但没 100% 排除；如果再遇到，值得查一下。

## 测试怎么组织

- `packages/core/test/helpers/repo.ts` 提供 `makeRepo` / `initClone` / `commitIn`，
  所有 git 集成测试都用它造真实仓库，**不 mock git**。
- `apps/server/test/*.test.ts` 用 `app.inject`（不起真端口），内存库 `openDatabase(':memory:')`。
  批量任务用 `waitForTask()` 轮询快照——SSE 在测试里不测（web 侧用假 EventSource 覆盖）。
- `apps/web/src/**/*.test.tsx` 用 msw；`onUnhandledFrame: 'error'` 保证没 mock 的请求会失败，
  避免「测试通过但压根没打到接口」的假绿。
- 测试里造仓库很慢（Windows 上每条 git 命令几百毫秒），所以 server 的集成测试
  `vi.setConfig({ testTimeout: 90_000 })`。全量约 2 分钟。
