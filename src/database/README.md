# Database module (planned for Phase 2)

This folder will contain the PostgreSQL connection, migrations, repositories,
and transaction helpers. Database access will stay behind service/repository
interfaces so Discord command handlers do not contain SQL.

Every guild-owned table will include `guild_id`. XP events will use a unique
guild/event identifier so Discord retries cannot award the same XP twice.

Planned tables:

- `guild_settings`
- `guild_members`
- `xp_events`
- `daily_xp_totals`
- `xp_role_rewards`
- `xp_imports`
- `reminders`
- `countdowns`
- `emoji_events`
- `emoji_daily_totals`
