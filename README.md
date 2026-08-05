# Yapper

Yapper is a custom, self-hosted Discord leveling bot for **bluddington**. The
project uses TypeScript, Node.js, discord.js, PostgreSQL, and a deliberately
simple architecture intended to be approachable for a first-time bot developer.

## Current features

- Discord login and guild-scoped slash-command deployment.
- `/ping`, which replies with `Yap.`
- `/rank [user]` and `/level [user]` using one shared handler.
- `/xp info [user]` with the level formula and progress details.
- PostgreSQL migrations that run safely once and use an advisory lock.
- Guild-specific member XP, ranks, timestamped XP events, and daily totals.
- Duplicate-event protection through `UNIQUE (guild_id, discord_event_id)`.
- Separate raw legacy XP, adjusted legacy XP, and new Yapper XP columns.
- A CLI tool for inserting test XP before real message XP is enabled.
- Tests for the custom XP curve, level boundaries, and progress bars.
- Real message XP with configurable 20-30 XP awards and a 30-second cooldown.
- Text, attachment-only, thread, forum, and voice-channel text-chat support.
- In-memory duplicate/low-effort filtering without persisting message content.
- `/leaderboard` with all-time, weekly, monthly, and yearly views.
- Top 10 by default with requester-bound buttons and pages through Top 100.
- Europe/Berlin calendar boundaries and an honest launch-date label for the
  first partial weekly, monthly, and yearly periods.
- Private `/recent xp [user]` diagnostics with timestamps, sources, channels,
  amounts, and message jump links without storing message content.
- Audited `/xp admin view|add|remove|set` controls protected by Manage Server.
- Non-negative Yapper XP enforcement and immutable imported legacy baselines.
- Per-server `/xp roles add|remove|list|sync` configuration.
- Stackable level-role catch-up after message XP, admin XP, or manual sync.
- Clear diagnostics for missing roles, managed roles, missing Manage Roles
  permission, Discord assignment failures, and role hierarchy conflicts.
- Strict MEE6 `user_id,xp` CSV validation with row, total, and known-user checks.
- Auditable import previews, immutable raw XP, optional scaled XP, confirmed
  apply, and exact baseline rollback. Arcane data is comparison-only.

Yapper reads message content only long enough to decide whether a message is
meaningful and repeated. It stores a temporary one-way hash for duplicate
filtering; PostgreSQL receives IDs, timestamps, source type, and XP amount only.
Images and attachments are never downloaded or stored.

## Prerequisites

Install:

1. [Node.js](https://nodejs.org/) 22.12 or newer.
2. pnpm: `npm install --global pnpm`
3. [Docker Desktop](https://www.docker.com/products/docker-desktop/) for the
   local PostgreSQL database.
4. Git is recommended.

Check the installations in PowerShell:

```powershell
node --version
pnpm --version
docker --version
docker compose version
git --version
```

## Discord setup

Create **Yapper** in the [Discord Developer Portal](https://discord.com/developers/applications).
For Guild Install, use the `bot` and `applications.commands` scopes. Phase 2
only needs **View Channels** and **Send Messages** permissions.

For Phase 3, open the application's **Bot** page and enable **Message Content
Intent** under Privileged Gateway Intents. Yapper needs it for low-effort and
duplicate filtering; it does not persist the content.

For Phase 6 role rewards, open **Server Settings -> Roles -> Yapper**, enable
**Manage Roles**, and move Yapper's role above every XP reward role it should
grant. Yapper does not need Administrator. Discord prevents every bot from
granting managed/integration roles or roles at or above its own highest role.

Never paste the bot token into chat, source code, or GitHub. If a token is ever
shared, reset it immediately in the Developer Portal.

## Environment setup

Install dependencies and create the local environment file:

```powershell
pnpm install
Copy-Item .env.example .env
```

Fill the three Discord values in `.env`:

```dotenv
DISCORD_TOKEN=your_secret_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_private_test_server_id
```

The included local database defaults match this existing line:

```dotenv
DATABASE_URL=postgresql://yapper:change_me@localhost:5432/yapper
```

Optional message-XP settings have safe defaults:

```dotenv
XP_MIN_PER_MESSAGE=20
XP_MAX_PER_MESSAGE=30
XP_COOLDOWN_SECONDS=30
XP_DUPLICATE_WINDOW_SECONDS=120
```

Both `.env` and the PostgreSQL data volume are excluded from Git. The password
is only a local development default; production will use a strong secret.

## Start PostgreSQL

Start the database and check its health:

```powershell
docker compose up -d database
docker compose ps
```

Apply migrations explicitly:

```powershell
pnpm db:migrate
```

Yapper also checks and applies pending migrations at startup, so this command
is safe to run repeatedly.

## Add test XP

Enable Developer Mode in Discord, right-click your own user, and copy your User
ID. Insert 5,000 test XP with:

```powershell
pnpm xp:add-test -- --user-id YOUR_DISCORD_USER_ID --amount 5000
```

This creates a timestamped admin XP event and updates the member and daily-total
records in one transaction. It does not pretend that a chat message occurred.

## Deploy and run

Deploy commands after adding or changing command definitions:

```powershell
pnpm deploy:commands
```

Run Yapper in watch mode:

```powershell
pnpm dev
```

Then test `/ping`, `/rank`, `/level`, `/xp info`, and `/leaderboard` in the private server.
Send a meaningful message, wait at least 30 seconds, and use `/rank` again to
confirm that 20-30 XP was added.
Press `Ctrl+C` to stop the bot.

## Leaderboards

Run `/leaderboard` with no options for the all-time Top 10. Optional choices:

```text
/leaderboard scope:all page:1
/leaderboard scope:weekly page:1
/leaderboard scope:monthly page:1
/leaderboard scope:yearly page:1
```

Each page contains ten members, and the First/Previous/Next/Last buttons cover
the Top 100. Controls are bound to the person who opened the board so another
member cannot unexpectedly change the displayed page.

All-time XP includes adjusted legacy XP plus Yapper XP. Weekly, monthly, and
yearly boards use timestamped Yapper daily totals only. Weeks begin Monday at
00:00, months on the first day at 00:00, and years on January 1 at 00:00 in the
server's configured timezone. During Yapper's first partial period, the embed
clearly states that tracking begins at bot launch because historical period
activity cannot be reconstructed from MEE6 all-time XP.

## Moderator XP tools

`/recent xp [user]` is an ephemeral debugging command for members with Manage
Messages, Manage Server, or Administrator. It shows up to ten recent awards or
moderator adjustments with their source, timestamp, channel, XP amount, and a
message jump link when one exists. It never shows or stores message content.

The `/xp admin` command group is ephemeral and requires Manage Server or
Administrator:

```text
/xp admin view user:@member
/xp admin add user:@member amount:25 reason:Correction
/xp admin remove user:@member amount:25 reason:Duplicate award
/xp admin set user:@member amount:5000 reason:Approved baseline correction
```

These commands change only the member's Yapper XP. Raw and adjusted legacy XP
remain untouched. Applied changes store an audit record containing the target,
moderator, operation, requested amount, before/after balances, interaction ID,
channel, timestamp, and optional reason. XP cannot be removed below zero.

Moderator corrections intentionally do not change weekly, monthly, or yearly
activity boards; those remain a record of timestamped earning activity.

## Stackable XP roles

Members with Manage Roles or Administrator can use these private commands:

```text
/xp roles add role:@Level-1 level:1
/xp roles remove level:1
/xp roles list
/xp roles sync user:@member
```

Each level can grant one role, and each role can belong to one configured
level. Rewards stack: a level 10 member receives every configured reward at
levels 1 through 10 and keeps the earlier roles. Adding a new lower-level
reward later is safe; manual sync or the member's next qualifying XP award
performs catch-up.

Removing a reward configuration or lowering XP does not automatically revoke
roles from members. This avoids surprising destructive role changes. Automatic
sync runs after message XP and applied moderator XP changes; it only adds
missing roles the member currently qualifies for.

## MEE6 legacy XP import

The importer deliberately accepts a small CSV schema so usernames, levels, and
unrelated export data cannot be mistaken for XP:

```csv
user_id,xp
123456789012345678,250000
234567890123456789,125000
```

`user_id` must be the member's 17-20 digit Discord user ID. `xp` must be their
non-negative, raw MEE6 XP—not a level. A harmless example is available at
`examples/mee6-import.example.csv`. Put the real file in the ignored `imports`
folder so it can never be committed:

```powershell
New-Item -ItemType Directory -Force imports
# Save the private data as .\imports\mee6.csv
```

First validate the file without touching PostgreSQL. Known totals make an
accidentally incomplete export fail validation; repeat `--expected-user` for
several recognizable top members:

```powershell
pnpm xp:import -- validate --file .\imports\mee6.csv --expected-row-count 5500 --expected-total-raw-xp TOTAL --expected-user USER_ID:RAW_XP
```

Remove an expectation only when that number truly is not available. Validation
prints the ten highest raw-XP rows for comparison. After it passes, store an
auditable preview. This saves the rows and a SHA-256 file fingerprint but does
not change any member's XP:

```powershell
pnpm xp:import -- preview --file .\imports\mee6.csv --expected-row-count 5500 --expected-total-raw-xp TOTAL --expected-user USER_ID:RAW_XP
pnpm xp:import -- show --import-id IMPORT_ID
```

The multiplier defaults to `1`, preserving raw XP as adjusted XP. To scale the
legacy baseline, add (for example) `--multiplier 0.75` to both validation and
preview. Raw MEE6 XP always remains unchanged for auditing; only adjusted
legacy XP participates in all-time XP.

Applying or rolling back requires both a preview ID and the explicit
`--confirm` safety flag:

```powershell
pnpm xp:import -- apply --import-id IMPORT_ID --confirm
pnpm xp:import -- rollback --import-id IMPORT_ID --confirm
```

Only one applied MEE6 baseline can exist per server. Apply is transactional, so
either every row changes or none do. Rollback restores every prior legacy
baseline and preserves any Yapper XP earned after import. It refuses to proceed
if an imported baseline was changed unexpectedly, preventing silent data loss.
Imported XP affects ranks immediately. Stackable Discord roles catch up on a
member's next qualifying XP award or through `/xp roles sync user:@member`.

Arcane can be validated and stored as a comparison preview with `--source
arcane`, but the tool refuses to apply it. Adding overlapping Arcane and MEE6
history would double-count the same activity.

## Verification commands

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm check` runs type-checking, tests, and the production build together.

## Project structure

```text
compose.yaml                Local PostgreSQL service
migrations/                 Ordered SQL migrations
scripts/
  deploy-commands.ts        Register Discord slash commands
  migrate.ts                Apply pending database migrations
  add-test-xp.ts            Insert a safe test XP event
  import-xp.ts              Validate/preview/apply/rollback legacy XP
src/
  bot/                      Discord client and interaction routing
  commands/                 Slash-command definitions and handlers
  config/                   Environment validation
  database/                 Pool, migrations, and PostgreSQL services
  services/                 XP calculations and timezone-aware leaderboard logic
tests/                      Fast unit tests
```

## XP model

XP needed for the next level is:

```text
round(500 + 70 * level + 0.22 * level * level)
```

All-time XP is calculated as:

```text
adjusted legacy XP + new Yapper XP
```

Imported raw MEE6 XP remains separate for auditing. Arcane data will only be
used for comparison/calibration because adding overlapping Arcane and MEE6 XP
would double-count activity.

## Roadmap

1. **Complete:** local bot, GitHub, `/ping`, and the custom XP curve.
2. **Complete:** PostgreSQL, migrations, test XP, `/rank`, `/level`, `/xp info`.
3. **Complete:** privacy-conscious message XP, cooldowns, anti-spam, and totals.
4. **Complete:** paginated all/weekly/monthly/yearly leaderboards in Europe/Berlin time.
5. **Complete:** `/recent xp` and controlled moderator XP tools.
6. **Complete:** stackable XP role rewards with role-hierarchy checks.
7. **Current:** auditable MEE6 preview/apply/rollback imports.
8. Production Docker deployment, backups, restarts, and monitoring.
9. Reminders, countdowns, Google search, and emoji/reaction statistics.
