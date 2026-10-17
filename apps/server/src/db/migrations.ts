import { BUILTIN_CATEGORIES } from '@git-nest/core'

/**
 * Schema。**开发期就这一份，不写历史迁移步骤。**
 *
 * 约定：改结构 = 直接改这里 + 删掉本地库重建（`data/git-nest.db*`）。
 * 理由：眼下只有一个开发者在开发机上跑，随时能重建、随时能测；为「旧库」留
 * ALTER / DROP 步骤只会攒出一堆没人验证过的分支——`004_project_record` 就是这么
 * 来的（它删的正是 `001` 里的列，还得专门造一个假的旧库去测它）。
 * 用户原话：「我不想再看到为了什么什么旧机型考虑的数据迁移问题，明明在开发中，
 * 随时能测」。等真有别人的数据要保，再谈迁移。
 *
 * 所以：**旧库不会被就地升级**。若拿一个旧库启动，第一次查询就会报
 * `no such column: record` —— 那就删库重建。（清单里的项目重新扫一遍就回来了。）
 *
 * `schema_migrations` 那套按 id 增量执行的机制留着：加一张**新**表时仍然追加一条，
 * 比改 001 省事（但改已有表的结构，仍然是改 001 + 删库）。
 */
export const migrations = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE projects (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,          -- 本地绝对路径，仅存本地 DB，不外泄
        remote_url  TEXT,                          -- origin URL，可为空（纯本地项目）
        category    TEXT NOT NULL DEFAULT '',      -- 自由字符串，只管分组与筛选，不带行为
        is_own      INTEGER NOT NULL DEFAULT 0,    -- 我自己写的项目：批量检查默认跳过（0/1）
        record      TEXT NOT NULL DEFAULT '',      -- 你自己写的那段（怎么找到的、想法）
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
        status       TEXT NOT NULL,
        ahead_count  INTEGER,
        behind_count INTEGER,
        detail       TEXT
      );

      CREATE INDEX idx_projects_category ON projects(category);
      CREATE INDEX idx_project_tags_tag ON project_tags(tag_id);
      CREATE INDEX idx_update_checks_project ON update_checks(project_id, checked_at DESC);

      -- path 原有 UNIQUE 是区分大小写的，而 Windows 的文件系统不区分：
      -- 同一个目录可以用不同大小写写进清单两条（状态查两次、DELETE 只删一条）。
      -- 这里在库层再兜一道（应用层 pathExists 也按 lower 比较，两边语义一致）。
      -- 用部分索引：path 为空的记录不参与。
      CREATE UNIQUE INDEX idx_projects_path_ci
        ON projects(lower(path)) WHERE path IS NOT NULL;
    `,
  },
  {
    id: '002_settings',
    sql: `
      -- 键值设置：超时 / 并发 / 扫描目录那几个参数。本机单用户工具，不做正经的配置系统。
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: '003_project_logos',
    sql: `
      -- 从仓库里认出来的 logo。**一张结论表**，和 update_checks 同一类东西：
      -- 存「选中了哪个文件」+「得出它时 README 的指纹」，**不存图片本身**
      -- （不变量：能从仓库自己读出来的不存）。
      --
      -- path 为 NULL = 识别过了、这个项目没有 logo。那是个结论，不是「还没算」——
      -- 分不开的话，每次打开清单都要把没有 logo 的项目重算一遍。
      -- stamp 与当前指纹不一致 = 结论过期（README 变了），下次请求时才重算。
      CREATE TABLE project_logos (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        path       TEXT,
        stamp      TEXT NOT NULL,
        picked_at  TEXT NOT NULL
      );
    `,
  },
  {
    id: '004_categories',
    /*
      分类表。**加一张新表就追加一条**（改已有表的结构仍然是改 001 + 删库）。

      这里最关键的一点：种子的 key 与 `projects.category` 里**已经存着的值完全一样**
      （`knowledge-base` / `backups` / `experiments` / `tools`），所以这张表不涉及任何
      数据迁移——它只是给那些值补上「显示名 + 图标 + 是不是内置」。

      种子从 `BUILTIN_CATEGORIES` 生成而不是手写一遍：那份常量同时是前端的兜底来源，
      两处各写一份必然漂开（这个仓库已经吃过一次「同一个名字两处定义」的亏）。

      **故意没有指向 projects 的外键**：未分类在库里是**空串**，它不是这张表的一行，
      加了外键那种项目就写不进去。存在性校验因此落在应用层
      （`repos/categories.ts` 的 `isAssignableCategory`）。
    */
    sql: `
      CREATE TABLE categories (
        key        TEXT PRIMARY KEY,           -- 唯一标识；projects.category 存的就是它
        label      TEXT NOT NULL,              -- 显示名，用户分类可改
        icon       TEXT,                       -- 可选图标名
        builtin    INTEGER NOT NULL DEFAULT 0, -- 内置项不可改名、不可删
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_categories_sort ON categories(sort_order);

      INSERT INTO categories (key, label, icon, builtin, sort_order) VALUES
        ${BUILTIN_CATEGORIES.map(
          (c) => `('${c.key}', '${c.label}', '${c.icon}', 1, ${c.sortOrder})`,
        ).join(',\n        ')};
    `,
  },
  {
    id: '005_categories_label_unique',
    /*
      分类显示名的唯一索引。**库层兜底**，与 `projects.path` 同一个两层结构：
      应用层那条规则（`categoryLabelProblem`）负责给「跟谁撞了」这种好消息，
      这一层负责兜**并发**——两个同名请求同时通过应用层检查时，只有一条能落库。

      ⚠️ **它压不掉「内部多空格」**：索引表达式是 `lower(trim(label))`，trim 只去两头，
      于是『AI  项目』与『AI 项目』在它眼里是两个不同的值。那一段由应用层的
      `normalizeCategoryLabel` 负责（**写入之前**就把内部连续空白压成一个）。
      两张网合起来才是完整的规则——只留索引会漏，只留应用层会让并发穿透。

      加它之前查过现有数据：本机库里只有内置四条，`lower(trim(label))` 无重复，
      所以建索引是安全的。真有违反的行时 SQLite 会直接报错、迁移失败——那时要做的是
      把那些行改掉，**不是**把索引去掉。
    */
    sql: `
      CREATE UNIQUE INDEX idx_categories_label_unique ON categories(lower(trim(label)));
    `,
  },
  {
    id: '006_project_transports',
    /*
      「这个项目走哪条传输方式走通过」——**一条结论，不是事实来源**。
      事实（origin 地址）永远从仓库自己读，这张表只记「上次哪条路通了」。

      为什么需要它：某个项目的 origin 是 HTTPS，`git fetch` 报连接被重置/443 连不上，
      而同一分钟别的 SSH 项目 fetch 成功。没有这张表，每次检查/自动 fetch 都要先把
      那条注定失败的 21 秒超时**再踩一遍**，才知道该换路；记住之后，换过去的
      那条路就是首选（见 core 的 `fetchWithFallback` 与 `FETCH_TIMEOUT` 那段注释）。

      **只记结论、不做任何 URL 改写**：不 `remote set-url`、不碰 `.git/config`。
      用户改了 remote（换仓库、换主机）时，core 会发现「记住的那条路与当前地址
      对不上」而退回规范顺序，不需要迁移或清理。

      transport 只有 'https' / 'ssh' 两种取值；没有记录 = 还没成功走过任何一条。
      外键级联：项目删了，这条结论跟着走。
    */
    sql: `
      CREATE TABLE project_transports (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        transport  TEXT NOT NULL,   -- 'https' | 'ssh'
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: '007_repo_state',
    /*
      每个仓库一行的「当前状态」——**主体业务表**。

      ## 为什么要它（这是 `docs/软件定位.md` §10 的第一行）

      在这张表之前，同一个事实有三种读法：清单的「差异」列现场读本地 refs、
      「状态」列从 `update_checks` 里挑最新一行（相关子查询 + 解析 detail 的 JSON）、
      提交列表只在检查任务的内存里。三个都"对"，但**谁也不是权威**，于是每加一个
      字段都要在三处保证一致。

      现在：一个仓库一条数据，`sync()` 是唯一的写入者，读的人只读这一行。

      ## 与 `update_checks` 的分工

      - 这张表 = **当前值**（一个项目一行，覆盖写）；
      - `update_checks` = **流水**（追加，可删的派生物，只写不读）。

      `checked_at` 与 `attempt_at` 分开是刻意的：一次失败的同步**不该**把上一次
      好结论擦掉（那会让「上次看是最新」在断网时变成「没查过」），但失败本身要看得见
      ——于是好结论留在 `checked_at`/`status`/…，失败写进 `attempt_at`/`error`。

      `ahead`/`behind` 允许 NULL：读不出来与 0 是两件事（0 = 一样多，NULL = 没读到）。
    */
    sql: `
      CREATE TABLE repo_state (
        project_id   INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        checked_at   TEXT NOT NULL,               -- 最近一次**合格**同步的时间
        status       TEXT NOT NULL,               -- UpdateStatus（behind / up_to_date / …）
        ahead        INTEGER,                     -- NULL = 没读到，不是 0
        behind       INTEGER,
        verdict      TEXT,                        -- '推不推荐更新'那个结论；NULL = 没算出来
        can_pull     INTEGER NOT NULL DEFAULT 0,  -- 此刻是不是真有东西可拉
        upstream_sha TEXT,                        -- 下次判「作者改写历史」的基线
        incoming     TEXT NOT NULL DEFAULT '[]',  -- 要拉进来的前几条提交（JSON）
        attempt_at   TEXT NOT NULL,               -- 最近一次**尝试**（成功或失败）
        attempt_status TEXT NOT NULL,             -- 最近一次尝试得出的状态（失败时是 error / no_remote…）
        error        TEXT                         -- 最近一次尝试的失败原因（JSON）；NULL = 没失败
      );
    `,
  },
] as const
