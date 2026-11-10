CREATE TABLE higherlower_legacy_wins (
  guild_id TEXT NOT NULL,
  source_bot_id TEXT NOT NULL,
  wins INTEGER NOT NULL CHECK (wins >= 0),
  PRIMARY KEY (guild_id, source_bot_id)
);

-- Operator-supplied shared total; historical channel/player attribution is unknown.
INSERT INTO higherlower_legacy_wins (guild_id, source_bot_id, wins)
VALUES ('939811280657719327', '934459165403906128', 922)
ON CONFLICT (guild_id, source_bot_id) DO NOTHING;

CREATE TABLE higherlower_wins (
  message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX higherlower_wins_guild_channel_idx ON higherlower_wins (guild_id, channel_id);
