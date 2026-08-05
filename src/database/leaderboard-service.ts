import type { Pool } from "pg";

import {
  LEADERBOARD_MAX_ENTRIES,
  LEADERBOARD_PAGE_SIZE,
  type LeaderboardEntry,
  type LeaderboardPage,
  type LeaderboardScope,
  type LeaderboardService,
} from "../services/leaderboards/leaderboard-service.js";
import { calculateLeaderboardPeriod } from "../services/leaderboards/leaderboard-period.js";

interface GuildSettingsRow {
  timezone: string;
  launched_at: Date;
}

interface CountRow {
  count: string;
}

interface EntryRow {
  user_id: string;
  xp: string;
}

function parseDatabaseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

function buildTotalsQuery(
  guildId: string,
  scope: LeaderboardScope,
  periodStart: string | null,
  periodEnd: string | null,
): { sql: string; parameters: unknown[] } {
  if (scope === "all") {
    return {
      sql: `
        SELECT
          user_id,
          (legacy_xp_adjusted + new_bot_xp)::bigint AS xp
        FROM guild_members
        WHERE guild_id = $1
          AND legacy_xp_adjusted + new_bot_xp > 0
      `,
      parameters: [guildId],
    };
  }

  if (!periodStart || !periodEnd) {
    throw new Error(`Missing date boundaries for the ${scope} leaderboard.`);
  }

  return {
    sql: `
      SELECT user_id, SUM(amount)::bigint AS xp
      FROM daily_xp_totals
      WHERE guild_id = $1
        AND xp_date BETWEEN $2::date AND $3::date
      GROUP BY user_id
      HAVING SUM(amount) > 0
    `,
    parameters: [guildId, periodStart, periodEnd],
  };
}

export class PostgresLeaderboardService implements LeaderboardService {
  public constructor(
    private readonly pool: Pool,
    private readonly defaultTimezone: string,
  ) {}

  public async getPage(input: {
    guildId: string;
    scope: LeaderboardScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      throw new RangeError("Leaderboard page must be a positive whole number.");
    }

    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id, timezone)
        VALUES ($1, $2)
        ON CONFLICT (guild_id) DO NOTHING
      `,
      [input.guildId, this.defaultTimezone],
    );

    const settingsResult = await this.pool.query<GuildSettingsRow>(
      `
        SELECT timezone, launched_at
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
      launchedAt: settings.launched_at,
    });
    const totals = buildTotalsQuery(
      input.guildId,
      input.scope,
      period.startDate,
      period.endDate,
    );
    const countResult = await this.pool.query<CountRow>(
      `
        WITH leaderboard_totals AS (${totals.sql})
        SELECT COUNT(*)::text AS count
        FROM leaderboard_totals
      `,
      totals.parameters,
    );
    const participantCount = parseDatabaseInteger(
      countResult.rows[0]?.count ?? "0",
      "leaderboard participant count",
    );
    const visibleEntryCount = Math.min(
      participantCount,
      LEADERBOARD_MAX_ENTRIES,
    );
    const totalPages = Math.max(
      1,
      Math.ceil(visibleEntryCount / LEADERBOARD_PAGE_SIZE),
    );
    const page = Math.min(input.page, totalPages);
    const offset = (page - 1) * LEADERBOARD_PAGE_SIZE;
    const limitParameter = totals.parameters.length + 1;
    const offsetParameter = totals.parameters.length + 2;
    const entriesResult = await this.pool.query<EntryRow>(
      `
        WITH leaderboard_totals AS (${totals.sql})
        SELECT user_id, xp
        FROM leaderboard_totals
        ORDER BY xp DESC, user_id ASC
        LIMIT $${limitParameter}
        OFFSET $${offsetParameter}
      `,
      [...totals.parameters, LEADERBOARD_PAGE_SIZE, offset],
    );
    const entries: LeaderboardEntry[] = entriesResult.rows.map((row, index) => ({
      rank: offset + index + 1,
      userId: row.user_id,
      xp: parseDatabaseInteger(row.xp, "leaderboard XP"),
    }));

    return {
      scope: input.scope,
      page,
      pageSize: LEADERBOARD_PAGE_SIZE,
      totalPages,
      participantCount,
      visibleEntryCount,
      entries,
      timezone: settings.timezone,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      launchLimited: period.launchLimited,
      generatedAt: input.now,
    };
  }
}
