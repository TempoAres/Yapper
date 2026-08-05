# Yapper

Yapper is a custom, self-hosted Discord leveling bot for **bluddington**. This
repository currently contains the Phase 1 foundation: a clean TypeScript bot,
slash-command deployment, `/ping`, environment validation, the requested XP
curve, basic curve tests, and service boundaries for the later features.

## What works now

- Logs a Discord bot in without hard-coding its token.
- Registers slash commands in a private test server (recommended) or globally.
- Handles `/ping` and replies with `Yap.`
- Reports command failures without exposing details in Discord.
- Calculates levels using `500 + 70 × level + 0.22 × level²`.
- Includes placeholders for PostgreSQL, XP awards, leaderboards, XP roles,
  legacy imports, and emoji tracking.

PostgreSQL and real message XP are deliberately not connected in this first
phase. Yapper therefore does not need privileged message intents yet and does
not read or store message content.

## Prerequisites

Install these on your Windows development computer:

1. [Node.js](https://nodejs.org/) 22.12 or newer.
2. [pnpm](https://pnpm.io/installation): after installing Node, run
   `npm install --global pnpm` in PowerShell.
3. A Discord account and a private Discord server for testing.
4. Git is recommended but not required to run the bot.

Check the installations:

```powershell
node --version
pnpm --version
git --version
```

## 1. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select **New Application**, name it **Yapper**, and open it.
3. On the **Bot** page, create the bot if Discord asks you to do so.
4. Generate or reset the bot token and copy it somewhere temporary and safe.
   Treat this token like a password. Never paste it into source code or commit it.
5. Copy the **Application ID** from the application's general information page.
6. In Discord, enable **Developer Mode** under User Settings → Advanced. Right-
   click the private test server, choose **Copy Server ID**, and save that value.

For Phase 1, do not enable Message Content Intent. It is not needed by `/ping`.

## 2. Invite Yapper to the test server

Use the application's installation/OAuth settings in the Developer Portal to
create an invite with these scopes:

- `bot`
- `applications.commands`

No administrator permission is needed for `/ping`. Add only the permissions a
future feature actually requires; XP roles will later need **Manage Roles**.

## 3. Configure the project

Open PowerShell in this project folder and install dependencies:

```powershell
pnpm install
```

Make a local environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace these three values:

```dotenv
DISCORD_TOKEN=your_secret_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_private_test_server_id
```

`.env` is ignored by Git. `.env.example` is safe to commit because it contains
only placeholders.

## 4. Register `/ping`

Deploy the commands once after creating them or changing their names/options:

```powershell
pnpm deploy:commands
```

Keeping `DISCORD_GUILD_ID` set makes test commands update quickly. If it is
omitted, the script performs a global deployment, which Discord may take longer
to show.

## 5. Run Yapper

For development (automatically restarts after saved code changes):

```powershell
pnpm dev
```

When the terminal says that Yapper is online, use `/ping` in the test server.
The reply should be `Yap.` Press `Ctrl+C` in PowerShell to stop the bot.

Useful checks:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm start
```

`pnpm start` runs the previously built JavaScript from `dist`, so run
`pnpm build` first. `pnpm check` runs type-checking, tests, and the build in one
command and is a useful final check before committing changes.

## Project structure

```text
scripts/
  deploy-commands.ts       Uploads slash-command definitions to Discord
src/
  bot/                     Discord client and interaction routing
  commands/                One module per slash command
  config/                  Environment loading and validation
  database/                PostgreSQL plan; implementation comes in Phase 2
  services/
    xp/                    XP contracts and the implemented level curve
    leaderboards/          Weekly/monthly/yearly/all-time query contract
    roles/                 Stacked level-role contract
    imports/               Safe MEE6 import contract
    emoji/                 Future emoji/reaction tracking contract
tests/                     Small, fast automated tests
```

When adding a command, create its module in `src/commands`, export it from
`src/commands/index.ts`, run `pnpm deploy:commands`, and restart the bot.

## Planned phases

1. **Complete:** local TypeScript bot, `/ping`, command registration, XP curve.
2. Add PostgreSQL, migrations, repositories, and `/rank` + `/level` using test XP.
3. Add privacy-conscious XP events, cooldowns, anti-spam, and daily totals.
4. Add paginated all/weekly/monthly/yearly leaderboards in Europe/Berlin time.
5. Add `/recent xp` and controlled moderator XP tools.
6. Add stackable XP role rewards with role-hierarchy checks.
7. Add auditable MEE6 preview/apply/rollback imports; use Arcane only for
   comparison or calibration so overlapping XP is never double-counted.
8. Add Docker Compose, VPS deployment, restart policy, backups, and monitoring.
9. Add reminders, countdowns, Google search, and emoji/reaction statistics.

The database phase will keep `guild_id` on all guild-owned records and enforce
an idempotency constraint such as `(guild_id, discord_event_id)` on XP events.
Historical MEE6 XP will be stored separately from new Yapper XP, with all-time
XP calculated as adjusted legacy XP plus new Yapper XP.
