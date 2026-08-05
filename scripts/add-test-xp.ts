import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "../src/config/environment.js";
import { runMigrations } from "../src/database/migrate.js";
import { createDatabasePool } from "../src/database/pool.js";
import { PostgresXpService } from "../src/database/postgres-xp-service.js";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readAmount(): number {
  const rawAmount = readArgument("--amount") ?? "5000";
  const amount = Number(rawAmount);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("--amount must be a positive whole number.");
  }

  return amount;
}

async function addTestXp(): Promise<void> {
  const userId = readArgument("--user-id");

  if (!userId) {
    throw new Error(
      "Missing --user-id. Example: pnpm xp:add-test -- --user-id 123 --amount 5000",
    );
  }

  const guildId =
    readArgument("--guild-id") ?? process.env.DISCORD_GUILD_ID?.trim();

  if (!guildId) {
    throw new Error("Missing --guild-id and DISCORD_GUILD_ID is not configured.");
  }

  const amount = readAmount();
  const pool = createDatabasePool(loadDatabaseConfig());

  try {
    await runMigrations(pool);
    const xpService = new PostgresXpService(pool);
    const result = await xpService.award({
      guildId,
      userId,
      channelId: null,
      messageId: null,
      discordEventId: `test:${randomUUID()}`,
      amount,
      source: "admin",
      createdAt: new Date(),
    });

    if (!result.awarded) {
      throw new Error("The generated test XP event was unexpectedly duplicated.");
    }

    console.log(`Added ${amount} test XP to Discord user ${userId}.`);
  } finally {
    await pool.end();
  }
}

addTestXp().catch((error: unknown) => {
  console.error("Could not add test XP:", error);
  process.exitCode = 1;
});
