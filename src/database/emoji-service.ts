import type { Pool } from "pg";

import { calculateLeaderboardPeriod } from "../services/leaderboards/leaderboard-period.js";
import {
  EMOJI_LEADERBOARD_MAX_ENTRIES,
  EMOJI_LEADERBOARD_PAGE_SIZE,
  type EmojiLeaderboardEntry,
  type EmojiLeaderboardMetric,
  type EmojiLeaderboardPage,
  type EmojiMessageUsageInput,
  type EmojiService,
} from "../services/emoji/emoji-service.js";
import type { LeaderboardScope } from "../services/leaderboards/leaderboard-service.js";

interface GuildEmojiSettingsRow {
  timezone: string;
  emoji_tracking_started_at: Date;
}

interface InsertedUsageRow {
  emoji_key: string;
  amount: number;
}

interface CountRow {
  count: string;
}

interface LeaderboardRow {
  leaderboard_key: string;
  total: string;
}

function parseDatabaseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

function validateUsages(input: EmojiMessageUsageInput): Map<string, number> {
  if (Number.isNaN(input.createdAt.getTime())) {
    throw new RangeError("Emoji message timestamps must be valid dates.");
  }

  const usages = new Map<string, number>();

  for (const usage of input.usages) {
    if (
      !usage.emojiKey ||
      usage.emojiKey.length > 200 ||
      !Number.isSafeInteger(usage.amount) ||
      usage.amount <= 0
    ) {
      throw new RangeError("Emoji usages require a valid key and positive amount.");
    }

    const combined = (usages.get(usage.emojiKey) ?? 0) + usage.amount;

    if (!Number.isSafeInteger(combined)) {
      throw new RangeError("Combined emoji usage is outside the safe range.");
    }

    usages.set(usage.emojiKey, combined);
  }

  return usages;
}

function leaderboardSource(metric: EmojiLeaderboardMetric): {
  table: string;
  keyColumn: string;
} {
  return metric === "users"
    ? { table: "emoji_user_daily_totals", keyColumn: "user_id" }
    : { table: "emoji_usage_daily_totals", keyColumn: "emoji_key" };
}

export class PostgresEmojiService implements EmojiService {
  public constructor(private readonly pool: Pool) {}

  public async recordMessage(
    input: EmojiMessageUsageInput,
  ): Promise<{ recorded: number }> {
    const usages = validateUsages(input);

    if (usages.size === 0) {
      return { recorded: 0 };
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO guild_settings (guild_id)
          VALUES ($1)
          ON CONFLICT (guild_id) DO NOTHING
        `,
        [input.guildId],
      );
      const inserted = await client.query<InsertedUsageRow>(
        `
          INSERT INTO message_emoji_usage (
            guild_id,
            message_id,
            emoji_key,
            user_id,
            channel_id,
            amount,
            created_at
          )
          SELECT $1, $2, usage.emoji_key, $3, $4, usage.amount, $7
          FROM UNNEST($5::text[], $6::integer[]) AS usage(emoji_key, amount)
          ON CONFLICT (guild_id, message_id, emoji_key) DO NOTHING
          RETURNING emoji_key, amount
        `,
        [
          input.guildId,
          input.messageId,
          input.userId,
          input.channelId,
          [...usages.keys()],
          [...usages.values()],
          input.createdAt,
        ],
      );

      if (inserted.rows.length === 0) {
        await client.query("COMMIT");
        return { recorded: 0 };
      }

      const recorded = inserted.rows.reduce((sum, row) => sum + row.amount, 0);
      await client.query(
        `
          INSERT INTO emoji_user_daily_totals (
            guild_id,
            user_id,
            usage_date,
            amount
          )
          SELECT
            $1,
            $2,
            ($3::timestamptz AT TIME ZONE timezone)::date,
            $4
          FROM guild_settings
          WHERE guild_id = $1
          ON CONFLICT (guild_id, user_id, usage_date)
          DO UPDATE SET amount = emoji_user_daily_totals.amount + EXCLUDED.amount
        `,
        [input.guildId, input.userId, input.createdAt, recorded],
      );
      await client.query(
        `
          INSERT INTO emoji_usage_daily_totals (
            guild_id,
            emoji_key,
            usage_date,
            amount
          )
          SELECT
            $1,
            usage.emoji_key,
            ($2::timestamptz AT TIME ZONE settings.timezone)::date,
            usage.amount
          FROM UNNEST($3::text[], $4::integer[]) AS usage(emoji_key, amount)
          INNER JOIN guild_settings AS settings ON settings.guild_id = $1
          ON CONFLICT (guild_id, emoji_key, usage_date)
          DO UPDATE SET amount = emoji_usage_daily_totals.amount + EXCLUDED.amount
        `,
        [
          input.guildId,
          input.createdAt,
          inserted.rows.map((row) => row.emoji_key),
          inserted.rows.map((row) => row.amount),
        ],
      );
      await client.query("COMMIT");
      return { recorded };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getLeaderboardPage(input: {
    guildId: string;
    metric: EmojiLeaderboardMetric;
    scope: LeaderboardScope;
    page: number;
    now: Date;
  }): Promise<EmojiLeaderboardPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      throw new RangeError(
        "Emoji leaderboard page must be a positive whole number.",
      );
    }

    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id)
        VALUES ($1)
        ON CONFLICT (guild_id) DO NOTHING
      `,
      [input.guildId],
    );
    const settingsResult = await this.pool.query<GuildEmojiSettingsRow>(
      `
        SELECT timezone, emoji_tracking_started_at
        FROM guild_settings
        WHERE guild_id = $1
      `,
      [input.guildId],
    );
    const settings = settingsResult.rows[0];

    if (!settings) {
      throw new Error(`Guild settings are missing for ${input.guildId}.`);
    }

    const period = calculateLeaderboardPeriod({
      scope: input.scope,
      now: input.now,
      timezone: settings.timezone,
      launchedAt: settings.emoji_tracking_started_at,
    });
    const source = leaderboardSource(input.metric);
    const dateFilter =
      period.startDate && period.endDate
        ? "AND usage_date BETWEEN $2::date AND $3::date"
        : "";
    const parameters =
      period.startDate && period.endDate
        ? [input.guildId, period.startDate, period.endDate]
        : [input.guildId];
    const totalsQuery = `
      SELECT ${source.keyColumn} AS leaderboard_key, SUM(amount)::bigint AS total
      FROM ${source.table}
      WHERE guild_id = $1 ${dateFilter}
      GROUP BY ${source.keyColumn}
      HAVING SUM(amount) > 0
    `;
    const countResult = await this.pool.query<CountRow>(
      `SELECT COUNT(*)::text AS count FROM (${totalsQuery}) AS totals`,
      parameters,
    );
    const participantCount = parseDatabaseInteger(
      countResult.rows[0]?.count ?? "0",
      "emoji leaderboard participant count",
    );
    const visibleEntryCount = Math.min(
      participantCount,
      EMOJI_LEADERBOARD_MAX_ENTRIES,
    );
    const totalPages = Math.max(
      1,
      Math.ceil(visibleEntryCount / EMOJI_LEADERBOARD_PAGE_SIZE),
    );
    const page = Math.min(input.page, totalPages);
    const offset = (page - 1) * EMOJI_LEADERBOARD_PAGE_SIZE;
    const rows = await this.pool.query<LeaderboardRow>(
      `
        SELECT leaderboard_key, total::text
        FROM (${totalsQuery}) AS totals
        ORDER BY total DESC, leaderboard_key ASC
        LIMIT $${parameters.length + 1}
        OFFSET $${parameters.length + 2}
      `,
      [...parameters, EMOJI_LEADERBOARD_PAGE_SIZE, offset],
    );
    const entries: EmojiLeaderboardEntry[] = rows.rows.map((row, index) => ({
      rank: offset + index + 1,
      key: row.leaderboard_key,
      count: parseDatabaseInteger(row.total, "emoji usage count"),
    }));

    return {
      metric: input.metric,
      scope: input.scope,
      page,
      pageSize: EMOJI_LEADERBOARD_PAGE_SIZE,
      totalPages,
      participantCount,
      visibleEntryCount,
      entries,
      timezone: settings.timezone,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      generatedAt: input.now,
    };
  }
}
