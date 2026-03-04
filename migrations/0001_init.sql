-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  role TEXT DEFAULT 'user',
  subscription_status TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_end_date INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Analysis runs table
CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  contract TEXT NOT NULL,
  atm_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  status TEXT NOT NULL,
  model_response_json TEXT,
  summary_text TEXT,
  latency_ms INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tick specifications table
CREATE TABLE IF NOT EXISTS tick_specs (
  id TEXT PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  tick_size REAL NOT NULL,
  multiplier REAL NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Files table
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user ON analysis_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);

-- Insert default tick specifications
INSERT OR IGNORE INTO tick_specs (id, symbol, tick_size, multiplier) VALUES
  ('ts_es', 'ES', 0.25, 50),
  ('ts_nq', 'NQ', 0.25, 20),
  ('ts_ym', 'YM', 1.0, 5),
  ('ts_gc', 'GC', 0.1, 100),
  ('ts_cl', 'CL', 0.01, 1000);

-- Insert test user with active subscription (password: test123pass)
-- Password hash for 'test123pass': ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f
INSERT OR IGNORE INTO users (id, email, name, password_hash, role, subscription_status) VALUES
  ('user_test_dev', 'testuser@tradvio.com', 'Test Developer', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'user', 'active');
