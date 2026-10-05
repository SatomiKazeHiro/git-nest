# git-nest 交接文档

> 新会话先读这个，再读 `README.md`（怎么跑、API、技术栈、踩过的坑），最后读
> `docs/superpowers/specs/2026-06-20-git-nest-design.md`（设计 + 第 13 节的实现差异）。
>
> **这里只写代码里看不出来的东西**：不变量、待你决定的事、这个环境独有的坑。
> 文件结构、脚本、里程碑、提交历史一律去代码和 `git log` 里看，别在这儿再抄一份。

## 一句话现状

M1–M5 都做完了，功能与设计文档对齐，逐条差异记在设计文档第 13 节；唯一没做的是
第 10 节的 Agent 预留（本来就说本期不做）。

> 测试数量会随每次改动变化，别把它写进结论里——跑 `pnpm test` 看实际数字。

## 核心不变量（改代码前先确认没破坏）

> 编号别动：代码注释与设计文档里有「见不变量 N」的引用。

1. **绝不自动更新。** 检查只 fetch（不动工作区），更新只由用户勾选后触发，且只 `--ff-only`。
   禁止 `reset --hard` / `clean` / `push` / 任何历史重写。
2. **git 实时状态不落库**，每次现查（server 侧 3 秒短缓存，`?fresh=true` 绕开）。
   落库的下次打开就是旧数据，反而更危险。
3. **同仓库串行、跨仓库并发上限 4**；`Scheduler.schedule` 对同一 key 不可重入。
   所有 git 调用统一走 `runner.ts`（`-C` 而不是 cwd、超时、凭证、命令日志都在那一处）。
4. **勾选判据是判决的 `canPull`，不是 `status === 'behind'`。** 作者 force push
   （`rewritten`）或删库重建（`unrelated`）时，本地 refs 看到的**恰恰就是** `behind`。
   这道闸前后端各一道：前端禁勾只是建议，`runApply` 会再读 `update_checks.detail` 里的判决，
   是「别拉」就跳过（且不写新的检查行——那一步没读到任何新事实）。
5. **状态措辞按新鲜度降级**：状态接口不联网，「已是最新」在没依据时是失真的。
   从没查过 → 「没查过远程」且不给颜色；>12h → 「上次看是最新」；纯本地状态不受影响。
6. **本地绝对路径只存本机 SQLite**，不进任何会被提交的文件。
7. **core 有两个入口**：`@git-nest/core`（类型+zod，浏览器安全）、
   `@git-nest/core/git`（依赖 node:child_process，只能 node 侧引）。
   在 barrel 里 `export *` git 层会让浏览器包直接白屏。
   同理，`isomorphic-git` 只允许在 `src/git/inspect/via-lib.ts` 里引。
8. **列表页与详情页不共用状态缓存**。列表页走 lean 档，`dirty` 恒为 false、
   `lastCommit` 恒为 null；详情页与 `pull` 的前置检查走 full 档。混用会让详情页在几秒内
   谎报「干净」——而脏标记是第 1 条那个安全闸的判据。
9. **「推不推荐更新」只在真正问过远程之后才算**，而且结论**要落库**
   （`update_checks.detail` 里的 `verdict`）。清单页那条列读的是**上次检查的结论**，
   不是现算的——现算要先 fetch，而列表是纯本地读。没查过就显示「没查过」，
   绝不给绿色的「可更新」。
10. **判「作者改写历史」必须靠基线**（上次见到的上游 SHA）。只看本地 refs 判不出来：
    force push 掉本地从没读过的提交时，本地 HEAD 仍是新历史的祖先，git 自己也会快进。
    基线来自 `update_checks` 里记的、或 fetch 前本地 refs 指的那个。**读基线必须在 fetch 之前**。
11. **自动做的事必须留痕。** 自动 fetch 会自己联网，所以每一条 git 命令都进命令日志
    （`runner.ts` 的 `recentCommands`，带 `label` 标明发起者）。新增任何「自己会跑」的
    后台行为，都要能通过 `GET /api/commands` 查到。
12. **元数据只有一条线：能从仓库自己读出来的不存，只有用户知道的才存。**
    摘要是前者（README 现场读，只有扫描预览里出现、不落库），记录是后者
    （`projects.record` **一个文本框**，链接写在正文里）。不要因为「结构化更整齐」
    再拆出 notes 表、来源链接列、`kind` 字段那一类东西——那三样已经因为同一个原因撤过一次。
13. **一个编辑器，不是两个门。** 项目的可写字段（名称/路径/分类/标签/记录）全部只在
    「编辑资料」弹窗里改；页面各处只做展示与只读渲染（记录在详情页只读，正文里的 URL
    渲染成可点链接）。别再往页面或标签行旁边挂「快捷编辑」按钮——那不是捷径，是第二个入口，
    已经因此返工两次。
14. **开发期不做数据迁移。** 改结构＝直接改 `migrations.ts` 的 `001_init` + 删掉
    `data/git-nest.db*` 重建；**不写** ALTER / DROP 那类「照顾旧库」的步骤（写过一条 004，
    专门删 001 里的两列，还得造假库去测它）。加**新表**可以按 id 追加一条；改**已有表**的
    结构就是改 001 + 删库。旧库不会被就地升级——拿旧库启动会直接报 `no such column`，删库即可。

## 待用户决定的事

- **提交图要不要回来？** 一阶段从界面撤掉了（`@tomplum/react-git-log` 是个不虚拟化的
  HTML 网格，为 120 条提交就渲染出成百上千个节点；依赖也已移除）。
  后端接口 `GET /api/projects/:id/log` 与 core 的 `getLog` **保留着**，留给二阶段 Agent
  解析提交历史。要在界面上重新显示，得先解决虚拟化，别再直接塞回详情页。
- **`update_checks` 的历史要不要利用起来？**（比如「这个仓库近 30 天更新了 5 次」）
  目前它只存不用，外加给「推不推荐更新」当基线与结论载体。
- **Agent 接入**（设计文档第 10 节）：本来就说本期不做。

## 这个环境独有的坑

（git 行为、依赖安装那些坑都写在 `README.md` 的「踩过的坑」里，这里不重复。）

1. **别用 Windows PowerShell 的 `Invoke-RestMethod` 验中文接口**：它会把 body 里的非 ASCII
   编成 `?`（U+003F），看起来像服务端丢字——我为此报过一次假警报。验中文往返用 node 的
   `fetch`（或 `curl.exe`），并且拿**码点**比而不是看控制台输出（渲染也会骗人）：
   `[...s].map(c => c.codePointAt(0))`。
2. 用 heredoc 跑 `python - <<'EOF'` 改仓库里的文件**会静默失败**（不报错也没写进去）。
   改文件一律用编辑/写文件的工具。
3. **删开发库 `data/git-nest.db*` 之前先停掉自己的 dev server**：库被它占着会报
   「being used by another process」。按端口找 PID 停（`netstat -ano | grep :5174`）——
   注意 IPv6（`[::1]:5174`）上可能还挂着一个残留实例。
4. 验证 UI 用 `playwright-cli`（`open` / `snapshot` / `find` / `screenshot`）；起服务前先删
   `apps/web/node_modules/.vite`，否则改完组件会白屏（报 "does not provide an export named ..."）。
5. msw 3.x 里 `server.listen` 的选项叫 `onUnhandledFrame`（2.x 是 `onUnhandledRequest`）。
6. 写中文文件偶尔混进 U+FFFD 坏字符：提交前跑 `pnpm check:encoding`，比肉眼可靠。
7. `pnpm install` 偶尔「假装 up-to-date」什么都不做，删 `node_modules/.modules.yaml` 也没用；
   全量 `rm -rf node_modules && pnpm install` 才行（store 有硬链接，很快）。

## 测试怎么组织（只留看不出来的）

- git 集成测试全部用临时目录里的**真实仓库**，不 mock git。造仓库很慢（Windows 上每条 git
  命令几百毫秒），所以 core 与 server 都把超时放宽到 60s（core 在 `vitest.config.ts`，
  server 在各测试文件里 `vi.setConfig`）。全量约 40–60 秒。
- web 侧用 msw，且 `onUnhandledFrame: 'error'`——没 mock 的请求必须失败，免得出现
  「测试通过但压根没打到接口」的假绿。
- `apps/server/test/docs-api-drift.test.ts` 拿文档里写的 API 端点与 `GIT_NEST_*` 变量和源码
  对账：改路由却忘了改文档会红。
