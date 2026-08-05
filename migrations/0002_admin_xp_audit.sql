CREATE TABLE xp_admin_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL,
  moderator_user_id TEXT NOT NULL,
  channel_id TEXT,
  discord_interaction_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('add', 'remove', 'set')),
  requested_amount BIGINT NOT NULL,
  previous_new_bot_xp BIGINT NOT NULL CHECK (previous_new_bot_xp >= 0),
  new_new_bot_xp BIGINT NOT NULL CHECK (new_new_bot_xp >= 0),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, discord_interaction_id),
  CHECK (
    (operation = 'set' AND requested_amount >= 0)
    OR (operation IN ('add', 'remove') AND requested_amount > 0)
  )
);

CREATE INDEX xp_admin_audit_target_history_idx
  ON xp_admin_audit (guild_id, target_user_id, created_at DESC);
