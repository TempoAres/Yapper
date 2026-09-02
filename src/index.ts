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
import { PostgresReactionService } from "./database/reaction-service.js";
import { PostgresEmojiService } from "./database/emoji-service.js";
import { PostgresReminderService } from "./database/reminder-service.js";
import { PostgresLeaderboardAnnouncementDeliveryService } from "./database/leaderboard-announcement-service.js";
import { PostgresJournalService } from "./database/journal-service.js";
import { DiscordRoleRewardCoordinator } from "./bot/role-reward-coordinator.js";
import {
  loadBotConfig,
  loadDatabaseConfig,
  loadHealthConfig,
  loadJournalConfig,
  loadLeaderboardAnnouncementConfig,
  loadLeaderboardConfig,
  loadMessageXpConfig,
} from "./config/environment.js";
import { MessageXpTracker } from "./services/xp/message-xp-tracker.js";
import { ReactionTracker } from "./services/reactions/reaction-tracker.js";
import { ReminderRunner } from "./services/reminders/reminder-runner.js";
import { LeaderboardAnnouncementRunner } from "./services/leaderboards/leaderboard-announcement-runner.js";
import { JournalRunner } from "./services/journal/journal-runner.js";
import { OpenAiJournalSummarizer } from "./services/journal/journal-summarizer.js";
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
  let reminderRunner: ReminderRunner | undefined;
  let leaderboardAnnouncementRunner: LeaderboardAnnouncementRunner | undefined;
  let journalRunner: JournalRunner | undefined;

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
    const reactionService = new PostgresReactionService(pool);
    const emojiService = new PostgresEmojiService(pool);
    const reminderService = new PostgresReminderService(pool);
    const journalService = new PostgresJournalService(pool);
    const journalConfig = loadJournalConfig();
    const leaderboardAnnouncementDeliveryService =
      new PostgresLeaderboardAnnouncementDeliveryService(pool);
    const roleRewardCoordinator = new DiscordRoleRewardCoordinator(
      roleRewardService,
      memberXpService,
    );
    const messageXpTracker = new MessageXpTracker(
      xpService,
      loadMessageXpConfig(),
    );
    const reactionTracker = new ReactionTracker(reactionService);
    client = await startBot(
      botConfig,
      {
        memberXpService,
        leaderboardService,
        adminXpService,
        recentXpService,
        roleRewardService,
        roleRewardCoordinator,
        reactionService,
        emojiService,
        reminderService,
        journalService,
        journalConfig: {
          targetUserId: journalConfig.targetUserId,
          summarizationConfigured: Boolean(journalConfig.openAiApiKey),
        },
      },
      messageXpTracker,
      reactionTracker,
    );
    reminderRunner = new ReminderRunner(client, reminderService);
    reminderRunner.start();

    if (journalConfig.targetUserId && journalConfig.openAiApiKey) {
      journalRunner = new JournalRunner(
        client,
        journalService,
        new OpenAiJournalSummarizer(
          journalConfig.openAiApiKey,
          journalConfig.openAiModel,
        ),
      );
      journalRunner.start();
    }
    const announcementChannelId =
      loadLeaderboardAnnouncementConfig().channelId;

    if (announcementChannelId) {
      if (!botConfig.guildId) {
        throw new Error(
          "DISCORD_GUILD_ID is required when leaderboard announcements are enabled.",
        );
      }

      leaderboardAnnouncementRunner = new LeaderboardAnnouncementRunner(
        client,
        leaderboardService,
        leaderboardAnnouncementDeliveryService,
        {
          guildId: botConfig.guildId,
          channelId: announcementChannelId,
        },
      );
      leaderboardAnnouncementRunner.start();
    }
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
      await Promise.all([
        reminderRunner?.stop(),
        leaderboardAnnouncementRunner?.stop(),
        journalRunner?.stop(),
      ]);
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
    await Promise.all([
      reminderRunner?.stop(),
      leaderboardAnnouncementRunner?.stop(),
      journalRunner?.stop(),
    ]);
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
