-- 001_initial: the MVP schema.
-- No column holds prompt text by design (AC-14); decisions keep a short generated reason only.
-- Migrations run inside a transaction the runner opens: never put BEGIN/COMMIT in this file.

CREATE TABLE agents (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  installed         INTEGER NOT NULL DEFAULT 0 CHECK (installed IN (0, 1)),
  version           TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  notes_json        TEXT NOT NULL DEFAULT '[]',
  detected_at       TEXT
);

CREATE TABLE providers (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('cloud', 'local')),
  status       TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled'))
);

CREATE TABLE models (
  id              TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL REFERENCES providers (id),
  display_name    TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'deprecated')),
  updated_at      TEXT NOT NULL
);

-- Versioned prices: one row per model per date, each with its source (ADR-008).
CREATE TABLE model_pricing (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id                TEXT NOT NULL REFERENCES models (id),
  currency                TEXT NOT NULL DEFAULT 'USD',
  input_per_million       REAL CHECK (input_per_million IS NULL OR input_per_million >= 0),
  output_per_million      REAL CHECK (output_per_million IS NULL OR output_per_million >= 0),
  cache_read_per_million  REAL CHECK (cache_read_per_million IS NULL OR cache_read_per_million >= 0),
  cache_write_per_million REAL CHECK (cache_write_per_million IS NULL OR cache_write_per_million >= 0),
  source_url              TEXT NOT NULL,
  as_of                   TEXT NOT NULL,
  UNIQUE (model_id, as_of)
);

CREATE TABLE routing_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority        INTEGER NOT NULL DEFAULT 0,
  definition_json TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  current_model TEXT,
  routing_mode  TEXT NOT NULL CHECK (routing_mode IN ('shadow', 'auto', 'off'))
);

-- session_id has no foreign key on purpose: a decision may be buffered by the
-- agent integration and arrive before (or without) its session row.
CREATE TABLE routing_decisions (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  turn_id             TEXT,
  agent_id            TEXT NOT NULL,
  subagent_id         TEXT,
  mode                TEXT NOT NULL CHECK (mode IN ('shadow', 'auto', 'off')),
  task_type           TEXT,
  classification_json TEXT,
  selected_model      TEXT NOT NULL,
  selected_effort     TEXT,
  alternatives_json   TEXT NOT NULL DEFAULT '[]',
  reason              TEXT NOT NULL,
  decision_source     TEXT NOT NULL,
  status              TEXT NOT NULL,
  applied_model       TEXT,
  applied_effort      TEXT,
  estimated_cost_usd  REAL,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_routing_decisions_created ON routing_decisions (created_at DESC);
CREATE INDEX idx_routing_decisions_session ON routing_decisions (session_id, created_at);

-- Real usage as the agent reported it; never estimated.
CREATE TABLE usage_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id        TEXT REFERENCES routing_decisions (id) ON DELETE SET NULL,
  session_id         TEXT NOT NULL,
  agent_id           TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  recorded_at        TEXT NOT NULL
);

CREATE INDEX idx_usage_records_session ON usage_records (session_id, recorded_at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE benchmark_runs (
  id           TEXT PRIMARY KEY,
  strategy     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}'
);
