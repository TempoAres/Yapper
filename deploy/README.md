# Yapper production deployment

This guide moves Yapper from a Windows development PC to an always-on Ubuntu
server. The production Compose stack runs three private services:

- `bot`: Yapper itself, built from the repository and run as a non-root user.
- `database`: PostgreSQL 17 with a persistent Docker volume.
- `backup`: one validated, checksummed database backup per day, retained for 14
  days by default.

No application or database port is published to the internet. Yapper connects
out to Discord, and Docker performs the health checks inside the private
network.

## 1. Prepare the server

Use a current 64-bit Ubuntu LTS VPS with at least 1 GB of RAM. Log in through
SSH, install Git, and install Docker Engine plus the Docker Compose plugin by
following Docker's official Ubuntu instructions:

<https://docs.docker.com/engine/install/ubuntu/>

Verify the result:

```bash
git --version
docker --version
docker compose version
sudo systemctl is-enabled docker
```

Docker starts automatically on supported Ubuntu installations. Adding your
account to the `docker` group is convenient but effectively grants root-level
control of the host; using `sudo docker` is the more conservative option.

The stack publishes no ports. Keep SSH reachable and enable the host firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

## 2. Clone the private repository

Create an SSH key dedicated to this server:

```bash
ssh-keygen -t ed25519 -C "yapper-production"
cat ~/.ssh/id_ed25519.pub
```

In GitHub, open **TempoAres/Yapper -> Settings -> Deploy keys -> Add deploy
key**. Paste the public key and leave write access disabled. Then verify GitHub
access and clone Yapper:

```bash
ssh -T git@github.com
git clone git@github.com:TempoAres/Yapper.git
cd Yapper
```

GitHub's first SSH prompt must show a fingerprint published in GitHub's own
documentation before you accept it.

## 3. Create configuration and secrets

The real secrets never belong in Git or the Compose environment file:

```bash
cp .env.production.example .env.production
mkdir -p secrets backups
chmod 700 secrets backups
nano secrets/discord_token.txt
```

Paste only the current Discord bot token, save, and close the editor. Generate
a separate strong PostgreSQL password:

```bash
openssl rand -base64 48 | tr -d '\n' > secrets/postgres_password.txt
chmod 600 secrets/discord_token.txt secrets/postgres_password.txt
nano .env.production
```

Confirm the application ID is `1534529857285787771` and the bluddington server
ID is `939811280657719327`. The remaining defaults are ready to use. Never put
the Discord token in `.env.production`, a command, a screenshot, chat, or
GitHub.

The optional private journal also needs an OpenAI Platform API key. Create a
project key for Yapper, make sure that API project has billing/credits, and put
only the key value into its own secret file:

```bash
nano secrets/openai_api_key.txt
chmod 600 secrets/openai_api_key.txt
```

Set `JOURNAL_USER_ID=939644859092992060` in `.env.production`. The production
example already selects the cost-efficient `gpt-5.6-luna` model. Never paste
the API key into `.env.production`, Discord, a shell command, a screenshot, or
GitHub. The Compose stack mounts the file read-only at runtime.

Journal session and message rows are deliberately excluded from Yapper's daily
logical PostgreSQL backups so temporary private transcripts are not retained in
the 14-day backup history.

## 4. Validate and start Yapper

Use the same Compose prefix for every production command:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build bot
docker compose --env-file .env.production -f compose.production.yaml up -d
docker compose --env-file .env.production -f compose.production.yaml ps
```

Wait about 30 seconds. `database` and `bot` should report `healthy`; `backup`
should be running. Check the startup and migration logs:

```bash
docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 bot
docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 backup
```

Before starting a build that includes full-server role sync, enable **Server
Members Intent** on Yapper's Discord Developer Portal **Bot** page. Passing the
intent without enabling it causes Discord to reject the bot connection.

Test `/ping`, `/rank`, `/lb`, `/rewards`, `/react received`, and
`/journal status` in
bluddington. Docker restarts Yapper
after a crash or host reboot, while the bot handles termination signals and
closes its Discord and PostgreSQL connections cleanly.

## 5. Verify backups

The backup container creates a backup immediately at startup and then once per
configured interval. List the host-readable files:

```bash
ls -lh backups
```

Create an extra backup on demand:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec backup /opt/yapper/deploy/backup-loop.sh once
```

Do not trust a backup merely because the file exists. Replace the filename
below with the newest `.dump`; verification checks its SHA-256 digest, restores
it into a temporary database, queries the member table, and deletes only that
temporary database:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm --entrypoint /bin/sh backup /opt/yapper/deploy/verify-backup.sh /backups/yapper_TIMESTAMP.dump
```

Copy backups to a second machine or storage provider as well. A backup stored
only on the VPS cannot help if the entire server is lost.

## 6. Update Yapper

After a GitHub pull request is merged:

```bash
cd ~/Yapper
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml build bot
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps bot node dist/scripts/deploy-commands.js
docker compose --env-file .env.production -f compose.production.yaml up -d bot
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 bot
```

The database volume and backup directory remain untouched. Yapper applies
pending migrations before logging in to Discord. Take and verify an on-demand
backup before any substantial update.

## 7. Restore after data loss

Restoring replaces the current database. First create and verify a final backup
when the current database is still readable. Then stop writers, verify the
chosen old backup again, and run the guarded restore:

```bash
docker compose --env-file .env.production -f compose.production.yaml stop bot backup
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps --entrypoint /bin/sh backup /opt/yapper/deploy/verify-backup.sh /backups/yapper_TIMESTAMP.dump
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps --entrypoint /bin/sh -e CONFIRM_RESTORE=RESTORE_YAPPER backup /opt/yapper/deploy/restore-backup.sh /backups/yapper_TIMESTAMP.dump
docker compose --env-file .env.production -f compose.production.yaml start bot backup
docker compose --env-file .env.production -f compose.production.yaml ps
```

The explicit `CONFIRM_RESTORE` value prevents an accidental overwrite. Check
the bot logs and Discord commands after recovery.

## Routine checks

Once a week:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --since 168h bot
docker compose --env-file .env.production -f compose.production.yaml logs --since 168h backup
df -h
```

Investigate containers that are restarting or unhealthy, repeated backup
failures, and low disk space. Docker log rotation is limited to three 10 MB
files per service so application logs cannot grow without bound.

## Emergency stop

```bash
docker compose --env-file .env.production -f compose.production.yaml stop bot
```

This stops XP collection but leaves PostgreSQL and backups running. Start the
bot again with the matching `start bot` command.
