ALTER TABLE leaderboard_announcement_deliveries
  DROP CONSTRAINT leaderboard_announcement_deliveries_scope_check;

ALTER TABLE leaderboard_announcement_deliveries
  ADD CONSTRAINT leaderboard_announcement_deliveries_scope_check
  CHECK (scope IN ('daily', 'weekly', 'monthly', 'yearly'));
