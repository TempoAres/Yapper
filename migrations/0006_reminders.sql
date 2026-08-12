CREATE TABLE reminders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  remind_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'delivering', 'delivered', 'cancelled')
  ),
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  delivery_started_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX reminders_due_idx
  ON reminders (next_attempt_at, id)
  WHERE status IN ('pending', 'delivering');

CREATE INDEX reminders_user_pending_idx
  ON reminders (guild_id, user_id, remind_at, id)
  WHERE status = 'pending';
