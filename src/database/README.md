# Database module

This folder contains the PostgreSQL pool, migration runner, XP transaction,
and rank query implementation. Database access stays behind service interfaces
so Discord command handlers do not contain SQL.

Every guild-owned table will include `guild_id`. XP events will use a unique
guild/event identifier so Discord retries cannot award the same XP twice.

The migrations create:

- `guild_settings`
- `guild_members`
- `xp_events`
- `daily_xp_totals`
- `xp_role_rewards`
- `xp_imports`
- `xp_import_rows` (validated raw/adjusted rows plus exact rollback snapshots)
- `xp_admin_audit`
- `reaction_memberships` (deduplicated active Discord reactions)
- `member_reaction_totals` (given/received leaderboard totals)

`xp_admin_audit` keeps moderator corrections separate from activity awards.
It records before/after Yapper XP and a Discord interaction ID for auditability
and retry safety. Admin corrections never overwrite imported legacy XP and do
not alter the daily activity totals used by period leaderboards.

`xp_role_rewards` is the per-guild Phase 6 configuration table. Its primary
and unique constraints enforce one reward per level and one configured level
per Discord role. Discord role assignment remains in the bot layer so database
queries never need Discord permissions or role-cache objects.

Reaction membership rows contain IDs and timestamps only; they never store
message content. Removing a reaction or message transactionally adjusts the
aggregated totals.
