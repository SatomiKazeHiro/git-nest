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
pnpm test         # vitest
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
    └── core/     共享 TS 类型 + zod 校验，前后端同一份
```

- `packages/core` 无 UI、无 HTTP 依赖，以源码形式被引用（`exports: ./src/index.ts`），改完不用构建。
- 元数据进 SQLite；git 实时状态不落库（M2 起每次现查）。
- 本地绝对路径只存在本机 SQLite 里，不进任何会被提交的文件。

## 前端技术栈怎么用

| 库 | 用途 |
|---|---|
| TanStack Query | 所有服务端状态：清单、详情、标签；写操作后统一 invalidate |
| Zustand | 纯 UI 状态：筛选条件、行选中、编辑弹窗 |
| Zod | 前后端共用同一份 schema（`packages/core/src/schemas.ts`），前端提交前先校验，错误逐字段显示 |
| ahooks | `useDebounce` 搜索防抖 |
| es-toolkit | `groupBy` 按分类分组、`orderBy` 分类/标签排序 |
| React Router | 三个视图：清单 `/`、详情 `/projects/:id`、设置 `/settings` |
| Tailwind v4 | 设计 token 定义在 `apps/web/src/index.css` 的 `@theme` 里 |

## 已完成

**M1 骨架** — 项目 CRUD、分类/标签/备注元数据、清单页与详情页、标签设置页。

- `GET/POST/PATCH/DELETE /api/projects`（支持 `category`/`tag`/`q` 过滤）
- `GET/PUT /api/projects/:id/tags`、`GET/POST /api/projects/:id/notes`、`PATCH/DELETE /api/notes/:id`
- `GET/POST/DELETE /api/tags`
- 删除项目只删 DB 记录，绝不动磁盘上的仓库
- 请求体验证统一走 zod，失败返回 422 + 逐字段说明

## 还没做

按设计文档的里程碑顺序：M2 git 状态与提交图 → M3 批量检查更新与 ff-only 更新（SSE）→ M4 目录扫描导入 → M5 错误归因与 Windows 兼容验证。

## 依赖安装的坑

`better-sqlite3` 需要跑安装脚本。pnpm 10+ 默认拦截，已在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 里放行；若换机器后报 `ERR_PNPM_IGNORED_BUILDS`，跑 `pnpm approve-builds --all`。
