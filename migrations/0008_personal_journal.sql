CREATE TABLE personal_journal_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN (
      'active',
      'summarizing',
      'awaiting_delivery',
      'delivered',
      'cancelled'
    )
  ),
  started_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > started_at),
  summary_text TEXT,
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  delivery_started_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX personal_journal_one_current_idx
  ON personal_journal_sessions (guild_id, user_id)
  WHERE status IN ('active', 'summarizing', 'awaiting_delivery');

CREATE INDEX personal_journal_due_idx
  ON personal_journal_sessions (next_attempt_at, id)
  WHERE status IN ('active', 'summarizing', 'awaiting_delivery');

CREATE TABLE personal_journal_messages (
  session_id BIGINT NOT NULL
    REFERENCES personal_journal_sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, message_id)
);

CREATE INDEX personal_journal_messages_order_idx
  ON personal_journal_messages (session_id, created_at, message_id);
