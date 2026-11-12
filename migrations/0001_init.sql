-- 募集（会）
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  theme TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,            -- YYYY-MM-DD（日本時間）
  start TEXT NOT NULL,           -- HH:MM
  end TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL,
  place TEXT NOT NULL DEFAULT '',
  min_people INTEGER NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,   -- 0 = 定員なし
  note TEXT NOT NULL DEFAULT '',
  host_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open / formed / cancelled
  formed_notified_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,     -- 管理者が非表示にした
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_date ON events(date);

-- 参加者
CREATE TABLE participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_participants_user ON participants(user_id);

-- LINEユーザー（保存するのは userId・表示名・状態だけ）
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  is_friend INTEGER NOT NULL DEFAULT 0,   -- Botと友だちか（個別通知できるか）
  is_member INTEGER NOT NULL DEFAULT 0,   -- 講座グループのメンバーか
  member_checked_at TEXT,
  last_seen_at TEXT
);

-- 設定（通知モードなど・通知先グループID）
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
