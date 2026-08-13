CREATE TABLE leaderboard_announcement_deliveries (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('daily', 'weekly', 'yearly')),
  reset_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'delivering', 'delivered')
  ),
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  delivery_started_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, scope, reset_at)
);

CREATE INDEX leaderboard_announcement_pending_idx
  ON leaderboard_announcement_deliveries (reset_at, guild_id, scope)
  WHERE status IN ('pending', 'delivering');
