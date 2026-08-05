CREATE TABLE xp_import_rows (
  import_id BIGINT NOT NULL REFERENCES xp_imports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  raw_xp BIGINT NOT NULL CHECK (raw_xp >= 0),
  adjusted_xp BIGINT NOT NULL CHECK (adjusted_xp >= 0),
  member_existed_before_apply BOOLEAN,
  previous_legacy_xp_raw BIGINT CHECK (previous_legacy_xp_raw >= 0),
  previous_legacy_xp_adjusted BIGINT CHECK (previous_legacy_xp_adjusted >= 0),
  PRIMARY KEY (import_id, user_id),
  CHECK (
    (member_existed_before_apply IS NULL
      AND previous_legacy_xp_raw IS NULL
      AND previous_legacy_xp_adjusted IS NULL)
    OR
    (member_existed_before_apply IS NOT NULL
      AND previous_legacy_xp_raw IS NOT NULL
      AND previous_legacy_xp_adjusted IS NOT NULL)
  )
);

CREATE INDEX xp_import_rows_import_xp_idx
  ON xp_import_rows (import_id, adjusted_xp DESC, user_id ASC);

-- Only one MEE6 baseline may be active for a server. A replacement import can
-- be applied after the current one is rolled back.
CREATE UNIQUE INDEX xp_imports_one_active_mee6_idx
  ON xp_imports (guild_id)
  WHERE source = 'mee6' AND status = 'applied';
