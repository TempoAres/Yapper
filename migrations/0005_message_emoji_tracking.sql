ALTER TABLE guild_settings
  ADD COLUMN emoji_tracking_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE message_emoji_usage (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  emoji_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (guild_id, message_id, emoji_key)
);

CREATE INDEX message_emoji_usage_user_history_idx
  ON message_emoji_usage (guild_id, user_id, created_at DESC);

CREATE INDEX message_emoji_usage_emoji_history_idx
  ON message_emoji_usage (guild_id, emoji_key, created_at DESC);

CREATE TABLE emoji_user_daily_totals (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  usage_date DATE NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (guild_id, user_id, usage_date)
);

CREATE INDEX emoji_user_daily_totals_period_idx
  ON emoji_user_daily_totals (guild_id, usage_date, amount DESC);

CREATE TABLE emoji_usage_daily_totals (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  emoji_key TEXT NOT NULL,
  usage_date DATE NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (guild_id, emoji_key, usage_date)
);

CREATE INDEX emoji_usage_daily_totals_period_idx
  ON emoji_usage_daily_totals (guild_id, usage_date, amount DESC);
