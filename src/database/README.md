# Database module

This folder contains the PostgreSQL pool, migration runner, XP transaction,
and rank query implementation. Database access stays behind service interfaces
so Discord command handlers do not contain SQL.

Every guild-owned table will include `guild_id`. XP events will use a unique
guild/event identifier so Discord retries cannot award the same XP twice.

The initial migration creates:

- `guild_settings`
- `guild_members`
- `xp_events`
- `daily_xp_totals`
- `xp_role_rewards`
- `xp_imports`

Reminder, countdown, and emoji tables will be added with their features rather
than committing unused schemas prematurely.
