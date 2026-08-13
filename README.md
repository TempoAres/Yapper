# Yapper

Yapper is a custom, self-hosted Discord leveling bot for **bluddington**. The
project uses TypeScript, Node.js, discord.js, PostgreSQL, and a deliberately
simple architecture intended to be approachable for a first-time bot developer.

## Current features

- Discord login and guild-scoped slash-command deployment.
- `/ping`, which replies with `Yap.`
- `/cmd`, which lists every user-facing command by category.
- `?g <query>`, which replies with a safely encoded Google search link.
- Image-based `/rank [user]` cards for member level, rank, XP, and progress.
- `/xp info [user]` with the level formula and progress details.
- PostgreSQL migrations that run safely once and use an advisory lock.
- Guild-specific member XP, ranks, timestamped XP events, and daily totals.
- Duplicate-event protection through `UNIQUE (guild_id, discord_event_id)`.
- Imported MEE6 XP preserved internally without exposing import bookkeeping in
  normal member commands.
- A CLI tool for inserting test XP before real message XP is enabled.
- Tests for the custom XP curve, level boundaries, and progress bars.
- Real message XP with configurable 15-40 XP awards and a 30-second cooldown.
- Text, attachment-only, thread, forum, and voice-channel text-chat support.
- In-memory duplicate/low-effort filtering without persisting message content.
- `/lb all|daily|weekly|monthly|yearly` level leaderboards with optional pages.
- `/xplb [page]` for the paginated all-time XP leaderboard.
- `/top daily|weekly|monthly|yearly` for each member's best historical activity period.
- `/wins daily|weekly|monthly|yearly` for completed XP leaderboard first-place finishes.
- `/react received|given` leaderboards with deduplicated reaction tracking.
- `/emoji all|daily|weekly|monthly|yearly` message-emoji leaderboards with Top Users
  and Top Emojis views.
- Arcane-style image leaderboards with avatars, one compact row per member,
  rank colors, progress bars, and requester-bound Top 100 pagination.
- Europe/Berlin calendar boundaries for daily, weekly, monthly, and yearly periods.
- `/reset info` with timezone-aware Discord countdowns for every period reset.
- Automatic final daily, weekly, and yearly leaderboards one minute before
  their Europe/Berlin reset.
- `/timestamp date:<date> time:<time>` for exact and relative Discord timestamps.
- Private `/recent xp [user]` diagnostics with timestamps, sources, channels,
  amounts, and message jump links without storing message content.
- Audited `/xp admin view|add|remove|set` controls protected by Manage Server.
- Non-negative editable XP enforcement and protected imported balances.
- Per-server `/xp roles add|remove|list|sync` configuration.
- One-time `/xp roles sync-all` catch-up for every current member with stored XP.
- Public `/rewards` list with colored role mentions and required levels, with
  notifications explicitly suppressed.
- Stackable level-role catch-up after message XP, admin XP, or manual sync.
- Clear diagnostics for missing roles, managed roles, missing Manage Roles
  permission, Discord assignment failures, and role hierarchy conflicts.
- Strict MEE6 `user_id,xp` CSV validation with row, total, and known-user checks.
- Auditable import previews, immutable raw XP, optional scaled XP, confirmed
  apply, and exact baseline rollback. Arcane data is comparison-only.
- A non-root production image, private Compose network, health checks, clean
  shutdowns, automatic restarts, rotated logs, and Docker-managed secrets.
- Daily checksummed PostgreSQL backups with safe temporary-restore verification
  and a deliberately guarded disaster-recovery command.

Yapper reads message content only long enough to decide whether a message is
meaningful and repeated, detect `?g`, and count eligible emoji. It stores a
temporary one-way hash for duplicate filtering; PostgreSQL receives IDs,
timestamps, source type, XP amounts, emoji keys, and emoji counts only. Message
text, images, and attachments are never downloaded or stored. Reminder text is
the deliberate exception: Yapper stores it until the reminder is delivered or
cancelled because the future ping could not work without it.

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

Open the application's **Bot** page and enable **Message Content Intent** plus
**Server Members Intent** under Privileged Gateway Intents. Message Content is
used for low-effort and duplicate filtering without persistence. Server Members
allows the protected `/xp roles sync-all` command to fetch the complete server
roster. Reaction tracking uses Discord's standard Guild Message Reactions
intent and needs View Channels plus Read Message History in the channels it
tracks.

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
XP_MIN_PER_MESSAGE=15
XP_MAX_PER_MESSAGE=40
XP_COOLDOWN_SECONDS=30
XP_DUPLICATE_WINDOW_SECONDS=120
```

Both `.env` and the PostgreSQL data volume are excluded from Git. The password
is only a local development default; production will use a strong secret.

## Production deployment

The production stack is separate from this local development setup. It builds
Yapper into a read-only, non-root container; waits for PostgreSQL to become
healthy; checks Discord and database readiness; restarts after failures or host
reboots; and writes validated daily backups to a host-readable folder.

Follow the beginner-oriented [production deployment guide](deploy/README.md).
The guide covers an Ubuntu VPS, private-repository access, secret creation,
startup, updates, monitoring, backup verification, and guarded restoration.

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

Then test `/ping`, `/cmd`, `?g Eiffel Tower`, `/timestamp`, `/rank`, `/xp info`,
`/lb all`, `/xplb`, and `/react received` in the private server.
Send a meaningful message, wait at least 30 seconds, and use `/rank` again to
confirm that 15-40 XP was added.
Press `Ctrl+C` to stop the bot.

## Leaderboards

`/lb` provides separate all-time, daily, weekly, monthly, and yearly subcommands:

```text
/lb all
/lb daily
/lb weekly
/lb monthly
/lb yearly
```

Every subcommand accepts an optional `page` from 1 to 10. The all-time board
shows each member's current level and progress. Daily, weekly, monthly, and yearly
boards show the levels and XP gained during the selected period.

`/xplb` shows the separate all-time XP leaderboard. It accepts an optional
`page` from 1 to 10 and uses the same requester-bound pagination buttons.

Historical records rank every member by their personal best period so far:

```text
/top daily
/top weekly
/top monthly
/top yearly
```

Leaderboard wins count how many completed XP periods each member finished in
first place, with daily, weekly, monthly, and yearly wins kept separate:

```text
/wins daily
/wins weekly
/wins monthly
/wins yearly
```

The active period is excluded until it ends. When XP totals tie, Yapper uses
the same stable user-ID tie-break order as the corresponding XP leaderboard,
so every completed period awards exactly one win. Each wins subcommand also
accepts an optional `page` from 1 to 10. Every row shows the member's total
wins and their average XP across the periods they won.

Every ranking is rendered as an image with one row per member, including the
member's avatar and Arcane-style rank coloring. Each page contains ten members,
and the First/Previous/Next/Last buttons cover the Top 100. Controls are bound
to the person who opened the board so another member cannot unexpectedly change
the displayed page.

Total XP includes the existing MEE6 import plus XP earned through Yapper.
Daily, weekly, monthly, and yearly boards use timestamped Yapper daily totals
only. Days reset at 00:00, weeks begin Monday at 00:00, months on the first day
at 00:00, and years on January 1 at 00:00 in the
server's configured timezone. Yapper's first partial period starts at bot
launch because historical period activity cannot be reconstructed from MEE6
all-time XP.

Current-period embeds show the complete calendar window, such as Monday through
Sunday, while their XP total includes only activity recorded so far in that
window. `/reset info` shows the next daily, weekly, monthly, and yearly
boundaries as Discord timestamps. Discord counts them down automatically; after
a boundary passes, running the command again calculates the following reset.
All-time and historical-record leaderboards do not reset.

When `LEADERBOARD_ANNOUNCEMENT_CHANNEL_ID` is configured, Yapper posts the
first page of the final daily leaderboard at 23:59 Europe/Berlin every night.
It also posts the final weekly board at 23:59 on Sundays and the final yearly
board at 23:59 on December 31. These image announcements contain no navigation
buttons or pings. Persistent delivery state and a stable Discord nonce prevent
duplicates if the bot restarts or retries during the final minute. Monthly
announcements are not enabled.

## Timestamps and reminders

`/timestamp` converts a local date and time into Discord's exact and relative
timestamp formats. It accepts `YYYY-MM-DD` or `DD.MM.YYYY` dates and 24-hour
`HH:MM` times. Input uses the server timezone, while Discord renders the result
in each reader's own timezone and keeps relative text such as “in 3 days” live.

Persistent reminders use the same date and time formats:

```text
/reminder set date:2026-08-20 time:18:30 message:Check the oven
/reminder list
/reminder cancel id:42
```

Yapper privately confirms creation, listing, and cancellation. At the selected
time it pings only the reminder creator in the channel where the reminder was
set. A member can keep up to ten pending reminders per server. Reminders survive
bot and VPS restarts, and temporary Discord delivery failures are retried with
increasing delays.

## Reaction leaderboards

`/react received` ranks members by reactions currently held on their messages;
`/react given` ranks members by reactions they have placed. Yapper starts these
counts when this feature is deployed. Bot reactions and reactions to bot
messages are ignored, and self-reactions do not count. Duplicate gateway events
cannot double-count a reaction. Removing a reaction, emoji, or message also
removes it from the totals.

## Message emoji leaderboards

`/emoji all`, `/emoji daily`, `/emoji weekly`, `/emoji monthly`, and
`/emoji yearly` open an Arcane-style image leaderboard. **Top Users** ranks
members by total emoji occurrences in new messages, while **Top Emojis** ranks
the emoji themselves. Buttons switch between both views and paginate through
the Top 100.

Tracking begins only when this feature is deployed; Yapper does not scan old
messages. Every Unicode emoji grapheme and every occurrence of a Bluddington
custom emoji counts. External custom emoji, bot messages, and webhooks are
ignored. Stored rows contain message metadata and aggregate counts, never
message content.

Unicode emoji leaderboard artwork is provided by
[Twemoji](https://github.com/jdecked/twemoji) under CC-BY 4.0.

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

These commands change only the member's editable XP balance; imported XP stays
protected internally. Applied changes store an audit record containing the target,
moderator, operation, requested amount, before/after balances, interaction ID,
channel, timestamp, and optional reason. XP cannot be removed below zero.

Moderator corrections intentionally do not change daily, weekly, monthly, or yearly
activity boards; those remain a record of timestamped earning activity.

## Stackable XP roles

Members with Manage Roles or Administrator can use these private commands:

```text
/xp roles add role:@Level-1 level:1
/xp roles remove level:1
/xp roles list
/xp roles sync user:@member
/xp roles sync-all
```

`/xp roles sync` synchronizes one member and defaults to the person running it.
`/xp roles sync-all` fetches the complete server roster, then grants every
missing earned role. It may take several minutes on a large server and reports
progress privately to the moderator who started it. Only one full sync can run
per server at a time.

Any member can run `/rewards` to see the configured level requirements. The
display uses real role mentions so Discord shows each role's configured color,
while allowed mentions are disabled so listing rewards never pings a role.

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
`examples/mee6-import.example.csv`.

When the MEE6 leaderboard is public, Yapper can fetch every page automatically.
The downloader waits between pages, retries temporary failures and rate limits,
rejects duplicate or malformed rows, and discards usernames, avatars, and all
other profile fields. Only the Discord ID and raw XP are written:

```powershell
pnpm xp:import -- fetch-mee6 --leaderboard-url "https://mee6.xyz/en/leaderboard/YOUR_SERVER_ID"
```

The file is saved as `imports\mee6.csv`. The root `imports` folder is ignored
so private member data cannot be committed. If that filename already exists,
the downloader preserves it; use `--overwrite` only after keeping any backup.
To make an empty folder manually instead, run:

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
compose.production.yaml     Hardened bot/database/backup production stack
Dockerfile                  Multi-stage non-root production image
deploy/                     VPS, backup, verification, and restore tooling
migrations/                 Ordered SQL migrations
scripts/
  deploy-commands.ts        Register Discord slash commands
  migrate.ts                Apply pending database migrations
  verify-database.ts        Verify leaderboard and reaction SQL safely
  add-test-xp.ts            Insert a safe test XP event
  import-xp.ts              Validate/preview/apply/rollback legacy XP
src/
  bot/                      Discord client and interaction routing
  commands/                 Slash-command definitions and handlers
  config/                   Environment validation
  database/                 Pool, migrations, and PostgreSQL services
  services/                 XP, reaction, role, and leaderboard logic
tests/                      Fast unit tests
```

## XP model

XP needed for the next level is:

```text
round(500 + 70 * level + 0.22 * level * level)
```

Total XP combines:

```text
existing imported XP + XP earned through Yapper
```

The import audit columns remain internal so an authorized rollback stays safe.
Arcane data is comparison-only because adding overlapping Arcane and MEE6 XP
would double-count activity.

## Roadmap

1. **Complete:** local bot, GitHub, `/ping`, and the custom XP curve.
2. **Complete:** PostgreSQL, migrations, test XP, `/rank`, and `/xp info`.
3. **Complete:** privacy-conscious message XP, cooldowns, anti-spam, and totals.
4. **Complete:** Arcane-style image level, reaction, and historical-record leaderboards in Europe/Berlin time.
5. **Complete:** `/recent xp` and controlled moderator XP tools.
6. **Complete:** stackable XP role rewards with role-hierarchy checks.
7. **Complete:** auditable MEE6 preview/apply/rollback imports.
8. **Complete:** production Docker deployment, backups, restarts, and monitoring.
9. **Complete:** reactions-given and reactions-received statistics.
10. **In progress:** timestamps and persistent reminders are complete; countdowns
    and optional utility commands remain future candidates.
