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
] as const
