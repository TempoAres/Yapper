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

Then test `/ping`, `/rank`, `/level`, and `/xp info` in the private server.
Send a meaningful message, wait at least 30 seconds, and use `/rank` again to
confirm that 20-30 XP was added.
Press `Ctrl+C` to stop the bot.

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
src/
  bot/                      Discord client and interaction routing
  commands/                 Slash-command definitions and handlers
  config/                   Environment validation
  database/                 Pool, migrations, and PostgreSQL services
  services/                 Domain contracts and XP calculations
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
3. **Current:** privacy-conscious message XP, cooldowns, anti-spam, and totals.
4. Paginated all/weekly/monthly/yearly leaderboards in Europe/Berlin time.
5. `/recent xp` and controlled moderator XP tools.
6. Stackable XP role rewards with role-hierarchy checks.
7. Auditable MEE6 preview/apply/rollback imports.
8. Production Docker deployment, backups, restarts, and monitoring.
9. Reminders, countdowns, Google search, and emoji/reaction statistics.
