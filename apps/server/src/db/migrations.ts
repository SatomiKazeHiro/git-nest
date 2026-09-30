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
] as const
