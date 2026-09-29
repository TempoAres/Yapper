CREATE TABLE afk_statuses (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  set_at TIMESTAMPTZ NOT NULL,
  clear_after TIMESTAMPTZ NOT NULL,
  original_nickname TEXT,
  applied_nickname TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX afk_statuses_guild_set_at_idx
  ON afk_statuses (guild_id, set_at);
