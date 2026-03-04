-- Add additional subscription tracking fields
ALTER TABLE users ADD COLUMN price_id TEXT;
ALTER TABLE users ADD COLUMN canceled_at INTEGER;

-- Create webhook events table for idempotency and debugging
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  data TEXT NOT NULL,
  processed_at INTEGER DEFAULT (unixepoch()),
  created_at INTEGER DEFAULT (unixepoch())
);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type, created_at DESC);
