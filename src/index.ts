import { startBot } from "./bot/create-bot.js";
import { PostgresMemberXpService } from "./database/member-xp-service.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";
import {
  loadBotConfig,
  loadDatabaseConfig,
} from "./config/environment.js";

async function main(): Promise<void> {
  const botConfig = loadBotConfig();
  const databaseConfig = loadDatabaseConfig();
  const pool = createDatabasePool(databaseConfig);

  try {
    await runMigrations(pool);
    const memberXpService = new PostgresMemberXpService(pool);
    const client = await startBot(botConfig, { memberXpService });
    let isShuttingDown = false;

    const shutDown = async (signal: NodeJS.Signals): Promise<void> => {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;
      console.log(`Received ${signal}; shutting Yapper down.`);
      client.destroy();
      await pool.end();
    };

    process.once("SIGINT", () => void shutDown("SIGINT"));
    process.once("SIGTERM", () => void shutDown("SIGTERM"));
  } catch (error) {
    await pool.end();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("Yapper could not start:", error);
  process.exitCode = 1;
});
