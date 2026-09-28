CREATE TABLE glossary_entries (
  guild_id TEXT NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  abbreviation TEXT NOT NULL CHECK (char_length(abbreviation) BETWEEN 1 AND 40),
  definition TEXT NOT NULL CHECK (char_length(definition) BETWEEN 1 AND 1500),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, abbreviation)
);

CREATE INDEX glossary_entries_guild_order_idx
  ON glossary_entries (guild_id, abbreviation);
