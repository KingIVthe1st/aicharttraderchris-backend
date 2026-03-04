-- Chat messages table for storing individual conversation messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  images TEXT, -- JSON array of image URLs (for user messages)
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);

-- Index for efficient message retrieval by analysis
CREATE INDEX IF NOT EXISTS idx_chat_messages_analysis ON chat_messages(analysis_id, created_at ASC);

-- Add conversation status to analysis_runs
ALTER TABLE analysis_runs ADD COLUMN conversation_status TEXT DEFAULT 'active';

-- Index for filtering active conversations
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status ON analysis_runs(user_id, conversation_status, created_at DESC);
