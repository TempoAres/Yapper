import { startBot } from "./bot/create-bot.js";
import type { Client } from "discord.js";
import type { Server } from "node:http";
import { PostgresMemberXpService } from "./database/member-xp-service.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";
import { PostgresXpService } from "./database/postgres-xp-service.js";
import { PostgresLeaderboardService } from "./database/leaderboard-service.js";
import { PostgresAdminXpService } from "./database/admin-xp-service.js";
import { PostgresRecentXpService } from "./database/recent-xp-service.js";
import { PostgresRoleRewardService } from "./database/role-reward-service.js";
import { DiscordRoleRewardCoordinator } from "./bot/role-reward-coordinator.js";
import {
  loadBotConfig,
  loadDatabaseConfig,
  loadHealthConfig,
  loadLeaderboardConfig,
  loadMessageXpConfig,
} from "./config/environment.js";
import { MessageXpTracker } from "./services/xp/message-xp-tracker.js";
import {
  startHealthServer,
  stopHealthServer,
} from "./health/health-server.js";

async function main(): Promise<void> {
  const botConfig = loadBotConfig();
  const databaseConfig = loadDatabaseConfig();
  const pool = createDatabasePool(databaseConfig);
  let client: Client | undefined;
  let healthServer: Server | undefined;

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
    const roleRewardService = new PostgresRoleRewardService(pool);
    const roleRewardCoordinator = new DiscordRoleRewardCoordinator(
      roleRewardService,
      memberXpService,
    );
    const messageXpTracker = new MessageXpTracker(
      xpService,
      loadMessageXpConfig(),
    );
    client = await startBot(
      botConfig,
      {
        memberXpService,
        leaderboardService,
        adminXpService,
        recentXpService,
        roleRewardService,
        roleRewardCoordinator,
      },
      messageXpTracker,
    );
    const healthPort = loadHealthConfig().port;

    if (healthPort !== undefined) {
      healthServer = await startHealthServer(healthPort, {
        isDiscordReady: () => client?.isReady() ?? false,
        checkDatabase: async () => {
          await pool.query("SELECT 1");
        },
      });
    }

    let isShuttingDown = false;

    const shutDown = async (signal: NodeJS.Signals): Promise<void> => {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;
      console.log(`Received ${signal}; shutting Yapper down.`);
      await stopHealthServer(healthServer);
      client?.destroy();
      await pool.end();
      console.log("Yapper shut down cleanly.");
    };

    const requestShutdown = (signal: NodeJS.Signals): void => {
      void shutDown(signal).catch((error: unknown) => {
        console.error("Yapper could not shut down cleanly:", error);
        process.exitCode = 1;
      });
    };

    process.once("SIGINT", () => requestShutdown("SIGINT"));
    process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  } catch (error) {
    await stopHealthServer(healthServer);
    client?.destroy();
    await pool.end();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("Yapper could not start:", error);
  process.exitCode = 1;
});
