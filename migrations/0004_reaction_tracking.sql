CREATE TABLE reaction_memberships (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  emoji_key TEXT NOT NULL,
  reactor_user_id TEXT NOT NULL,
  message_author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, message_id, emoji_key, reactor_user_id)
);

CREATE INDEX reaction_memberships_author_idx
  ON reaction_memberships (guild_id, message_author_id);

CREATE TABLE member_reaction_totals (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  reactions_given BIGINT NOT NULL DEFAULT 0 CHECK (reactions_given >= 0),
  reactions_received BIGINT NOT NULL DEFAULT 0 CHECK (reactions_received >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX member_reaction_totals_given_idx
  ON member_reaction_totals (guild_id, reactions_given DESC);

CREATE INDEX member_reaction_totals_received_idx
  ON member_reaction_totals (guild_id, reactions_received DESC);
