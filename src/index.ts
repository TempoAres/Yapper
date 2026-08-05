import { startBot } from "./bot/create-bot.js";
import { PostgresMemberXpService } from "./database/member-xp-service.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";
import { PostgresXpService } from "./database/postgres-xp-service.js";
import { PostgresLeaderboardService } from "./database/leaderboard-service.js";
import { PostgresAdminXpService } from "./database/admin-xp-service.js";
import { PostgresRecentXpService } from "./database/recent-xp-service.js";
import {
  loadBotConfig,
  loadDatabaseConfig,
  loadLeaderboardConfig,
  loadMessageXpConfig,
} from "./config/environment.js";
import { MessageXpTracker } from "./services/xp/message-xp-tracker.js";

async function main(): Promise<void> {
  const botConfig = loadBotConfig();
  const databaseConfig = loadDatabaseConfig();
  const pool = createDatabasePool(databaseConfig);

  try {
    await runMigrations(pool);
    const memberXpService = new PostgresMemberXpService(pool);
    const leaderboardService = new PostgresLeaderboardService(
      pool,
      loadLeaderboardConfig().defaultTimezone,
    );
    const xpService = new PostgresXpService(pool);
    const adminXpService = new PostgresAdminXpService(pool);
    const recentXpService = new PostgresRecentXpService(pool);
    const messageXpTracker = new MessageXpTracker(
      xpService,
      loadMessageXpConfig(),
    );
    const client = await startBot(
      botConfig,
      {
        memberXpService,
        leaderboardService,
        adminXpService,
        recentXpService,
      },
      messageXpTracker,
    );
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
