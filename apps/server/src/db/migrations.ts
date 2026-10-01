export const migrations = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE projects (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,          -- 本地绝对路径，仅存本地 DB，不外泄
        remote_url  TEXT,                          -- origin URL，可为空（纯本地项目）
        category    TEXT NOT NULL DEFAULT '',      -- 自由字符串
        source_url  TEXT,                          -- 来源链接（如 B 站视频）
        summary     TEXT,                          -- 一句话摘要
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
        status       TEXT NOT NULL,
        ahead_count  INTEGER,
        behind_count INTEGER,
        detail       TEXT
      );

      CREATE INDEX idx_projects_category ON projects(category);
      CREATE INDEX idx_project_tags_tag ON project_tags(tag_id);
      CREATE INDEX idx_notes_project ON notes(project_id, created_at);
      CREATE INDEX idx_update_checks_project ON update_checks(project_id, checked_at DESC);
    `,
  },
  {
    id: '002_settings',
    sql: `
      -- 键值设置：设计文档第 7.3 节那几个参数。本机单用户工具，不做正经的配置系统。
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: '003_projects_path_ci_unique',
    sql: `
      -- path 原有 UNIQUE 是区分大小写的，而 Windows 的文件系统不区分：
      -- 同一个目录可以用不同大小写写进清单两条（状态查两次、DELETE 只删一条）。
      -- 这里在库层再兜一道（应用层 pathExists 也按 lower 比较，两边语义一致）。
      -- 用部分索引：path 为空的记录不参与。
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path_ci
        ON projects(lower(path)) WHERE path IS NOT NULL;
    `,
  },
] as const
