ALTER TABLE personal_journal_sessions
  ADD COLUMN recurring BOOLEAN NOT NULL DEFAULT TRUE;

DROP INDEX personal_journal_one_current_idx;

CREATE UNIQUE INDEX personal_journal_window_start_idx
  ON personal_journal_sessions (guild_id, user_id, started_at);

CREATE INDEX personal_journal_active_window_idx
  ON personal_journal_sessions (guild_id, user_id, started_at, ends_at)
  WHERE status = 'active';

WITH realigned AS (
  UPDATE personal_journal_sessions AS session
  SET
    ends_at = (
      DATE_TRUNC('day', NOW() AT TIME ZONE settings.timezone)
      + INTERVAL '1 day'
    ) AT TIME ZONE settings.timezone,
    next_attempt_at = (
      DATE_TRUNC('day', NOW() AT TIME ZONE settings.timezone)
      + INTERVAL '1 day'
    ) AT TIME ZONE settings.timezone,
    recurring = TRUE
  FROM guild_settings AS settings
  WHERE settings.guild_id = session.guild_id
    AND session.status = 'active'
  RETURNING session.*
)
INSERT INTO personal_journal_sessions (
  guild_id,
  user_id,
  started_at,
  ends_at,
  next_attempt_at,
  recurring
)
SELECT
  realigned.guild_id,
  realigned.user_id,
  realigned.ends_at,
  (
    realigned.ends_at AT TIME ZONE settings.timezone
    + INTERVAL '1 day'
  ) AT TIME ZONE settings.timezone,
  (
    realigned.ends_at AT TIME ZONE settings.timezone
    + INTERVAL '1 day'
  ) AT TIME ZONE settings.timezone,
  TRUE
FROM realigned
JOIN guild_settings AS settings
  ON settings.guild_id = realigned.guild_id
ON CONFLICT (guild_id, user_id, started_at) DO NOTHING;
