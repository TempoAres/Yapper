import { loadDatabaseConfig } from "../src/config/environment.js";
import { PostgresLeaderboardService } from "../src/database/leaderboard-service.js";
import { PostgresMemberXpService } from "../src/database/member-xp-service.js";
import { createDatabasePool } from "../src/database/pool.js";
import { PostgresReactionService } from "../src/database/reaction-service.js";
import { PostgresReminderService } from "../src/database/reminder-service.js";

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function verify(): Promise<void> {
  const pool = createDatabasePool(loadDatabaseConfig());
  const guildId = `integration-${process.pid}-${Date.now()}`;
  const firstUserId = "100000000000000001";
  const secondUserId = "100000000000000002";

  try {
    await pool.query(
      `
        INSERT INTO guild_settings (guild_id, timezone, launched_at)
        VALUES ($1, 'Europe/Berlin', '2026-01-01T00:00:00.000Z')
      `,
      [guildId],
    );
    await pool.query(
      `
        INSERT INTO guild_members (
          guild_id,
          user_id,
          legacy_xp_adjusted,
          new_bot_xp
        )
        VALUES
          ($1, $2, 900, 100),
          ($1, $3, 1750, 250)
      `,
      [guildId, firstUserId, secondUserId],
    );
    await pool.query(
      `
        INSERT INTO daily_xp_totals (guild_id, user_id, xp_date, amount)
        VALUES
          ($1, $2, '2026-08-10', 200),
          ($1, $2, '2026-08-11', 100),
          ($1, $2, '2026-08-02', 50),
          ($1, $3, '2026-08-10', 250),
          ($1, $3, '2026-07-20', 1000)
      `,
      [guildId, firstUserId, secondUserId],
    );

    const leaderboardService = new PostgresLeaderboardService(
      pool,
      "Europe/Berlin",
    );
    const weekly = await leaderboardService.getPage({
      guildId,
      scope: "weekly",
      page: 1,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    requireCondition(
      weekly.entries[0]?.userId === firstUserId && weekly.entries[0].xp === 300,
      "The current weekly leaderboard returned the wrong winner.",
    );
    const xpMembers = await new PostgresMemberXpService(
      pool,
    ).listGuildMemberXp(guildId);
    requireCondition(
      xpMembers.length === 2 &&
        xpMembers.some(
          (member) => member.userId === secondUserId && member.allTimeXp === 2000,
        ),
      "The bulk role-sync XP query returned incorrect members.",
    );
    const weeklyRecords = await leaderboardService.getRecordPage({
      guildId,
      scope: "weekly",
      page: 1,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    requireCondition(
      weeklyRecords.entries[0]?.userId === secondUserId &&
        weeklyRecords.entries[0].xp === 1000 &&
        weeklyRecords.entries[0].recordStart === "2026-07-20" &&
        weeklyRecords.entries[0].recordEnd === "2026-07-26",
      `The historical weekly leaderboard returned the wrong record: ${JSON.stringify(weeklyRecords.entries[0])}`,
    );

    const reactionService = new PostgresReactionService(pool);
    const reaction = {
      guildId,
      messageId: "200000000000000001",
      emojiKey: "unicode:\uD83C\uDF89",
      reactorUserId: firstUserId,
      messageAuthorId: secondUserId,
      createdAt: new Date("2026-08-11T12:00:00.000Z"),
    } as const;
    requireCondition(
      (await reactionService.addReaction(reaction)).applied,
      "The first reaction was not recorded.",
    );
    requireCondition(
      !(await reactionService.addReaction(reaction)).applied,
      "A duplicate reaction was counted twice.",
    );
    requireCondition(
      (
        await reactionService.addReaction({
          ...reaction,
          emojiKey: "unicode:\u2764\uFE0F",
        })
      ).applied,
      "A second distinct reaction was not recorded.",
    );
    const received = await reactionService.getLeaderboardPage({
      guildId,
      metric: "received",
      page: 1,
      now: new Date(),
    });
    const given = await reactionService.getLeaderboardPage({
      guildId,
      metric: "given",
      page: 1,
      now: new Date(),
    });
    requireCondition(
      received.entries[0]?.userId === secondUserId &&
        received.entries[0].count === 2,
      "The reactions-received leaderboard is incorrect.",
    );
    requireCondition(
      given.entries[0]?.userId === firstUserId && given.entries[0].count === 2,
      "The reactions-given leaderboard is incorrect.",
    );
    requireCondition(
      (
        await reactionService.clearReactions({
          guildId,
          messageId: reaction.messageId,
          emojiKey: reaction.emojiKey,
        })
      ).removedCount === 1,
      "Emoji-specific reaction cleanup removed the wrong number of rows.",
    );
    requireCondition(
      (
        await reactionService.clearReactions({
          guildId,
          messageId: reaction.messageId,
        })
      ).removedCount === 1,
      "Message-wide reaction cleanup removed the wrong number of rows.",
    );
    const emptyReceived = await reactionService.getLeaderboardPage({
      guildId,
      metric: "received",
      page: 1,
      now: new Date(),
    });
    requireCondition(
      emptyReceived.entries.length === 0,
      "Reaction cleanup did not return the leaderboard to zero.",
    );

    const reminderService = new PostgresReminderService(pool);
    const futureReminder = await reminderService.create({
      guildId,
      userId: firstUserId,
      channelId: "300000000000000001",
      message: "Future reminder",
      remindAt: new Date("2026-08-20T12:00:00.000Z"),
    });
    const dueReminder = await reminderService.create({
      guildId,
      userId: firstUserId,
      channelId: "300000000000000001",
      message: "Due reminder",
      remindAt: new Date("2026-08-11T11:00:00.000Z"),
    });
    const pendingReminders = await reminderService.list({
      guildId,
      userId: firstUserId,
      limit: 10,
    });
    requireCondition(
      pendingReminders.length === 2 &&
        pendingReminders[0]?.id === dueReminder.id,
      "Pending reminders were not returned in delivery order.",
    );
    const dueReminders = await reminderService.claimDue({
      now: new Date("2026-08-11T12:00:00.000Z"),
      limit: 25,
    });
    requireCondition(
      dueReminders.length === 1 && dueReminders[0]?.id === dueReminder.id,
      "The reminder claim included the wrong rows.",
    );
    await reminderService.markDelivered(
      dueReminder.id,
      new Date("2026-08-11T12:00:00.000Z"),
    );
    requireCondition(
      await reminderService.cancel({
        guildId,
        userId: firstUserId,
        reminderId: futureReminder.id,
      }),
      "A pending reminder could not be cancelled.",
    );

    console.log("Database integration verified successfully.");
  } finally {
    await pool.query("DELETE FROM guild_settings WHERE guild_id = $1", [guildId]);
    await pool.end();
  }
}

verify().catch((error: unknown) => {
  console.error("Database integration verification failed:", error);
  process.exitCode = 1;
});
