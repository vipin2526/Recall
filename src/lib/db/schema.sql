PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  daily_ai_limit INTEGER NOT NULL DEFAULT 20,
  partial_counts_as TEXT NOT NULL DEFAULT 'forgot',
  ai_grading INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS noteboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  key_points TEXT NOT NULL,
  recall_prompt TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  source_hash TEXT,
  step INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_noteboxes_due
  ON noteboxes(user_id, deleted_at, suspended, due_at);
CREATE INDEX IF NOT EXISTS idx_noteboxes_source
  ON noteboxes(user_id, source_hash);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  notebox_id TEXT NOT NULL REFERENCES noteboxes(id),
  idempotency_key TEXT NOT NULL,
  rating TEXT NOT NULL,
  verdict TEXT,
  answer TEXT,
  feedback TEXT,
  step_before INTEGER NOT NULL,
  step_after INTEGER NOT NULL,
  interval_days INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  ai_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_reviews_user_time ON reviews(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_card_time ON reviews(notebox_id, created_at);

CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  validation_ok INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_calls_user_time ON ai_calls(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_calls_kind_time ON ai_calls(kind, created_at);

CREATE TABLE IF NOT EXISTS ai_cache (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  ai_call_id TEXT,
  notebox_id TEXT,
  surface TEXT NOT NULL,
  rating INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, surface, ai_call_id, notebox_id)
);

CREATE TABLE IF NOT EXISTS coach_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  summary TEXT NOT NULL,
  stats TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, week_start)
);

CREATE TABLE IF NOT EXISTS capture_dedup (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  notebox_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);
