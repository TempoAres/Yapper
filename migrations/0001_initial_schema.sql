CREATE TABLE guild_settings (
  guild_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  launched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guild_members (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  legacy_xp_raw BIGINT NOT NULL DEFAULT 0 CHECK (legacy_xp_raw >= 0),
  legacy_xp_adjusted BIGINT NOT NULL DEFAULT 0 CHECK (legacy_xp_adjusted >= 0),
  new_bot_xp BIGINT NOT NULL DEFAULT 0 CHECK (new_bot_xp >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX guild_members_all_time_xp_idx
  ON guild_members (guild_id, (legacy_xp_adjusted + new_bot_xp) DESC);

CREATE TABLE xp_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  discord_event_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL CHECK (
    source IN ('message', 'image', 'thread', 'forum', 'admin', 'import', 'reaction')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, discord_event_id)
);

CREATE INDEX xp_events_member_history_idx
  ON xp_events (guild_id, user_id, created_at DESC);

CREATE TABLE daily_xp_totals (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  xp_date DATE NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (guild_id, user_id, xp_date)
);

CREATE INDEX daily_xp_totals_period_idx
  ON daily_xp_totals (guild_id, xp_date, amount DESC);

CREATE TABLE xp_role_rewards (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  required_level INTEGER NOT NULL CHECK (required_level >= 0),
  role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, required_level),
  UNIQUE (guild_id, role_id)
);

CREATE TABLE xp_imports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('mee6', 'arcane')),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'applied', 'rolled_back')),
  multiplier NUMERIC(12, 6) NOT NULL DEFAULT 1 CHECK (multiplier >= 0),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);
