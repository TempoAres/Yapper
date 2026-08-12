import type { Pool } from "pg";

import {
  LEADERBOARD_MAX_ENTRIES,
  LEADERBOARD_PAGE_SIZE,
  type LeaderboardEntry,
  type LeaderboardPage,
  type LeaderboardRecordScope,
  type LeaderboardResetSchedule,
  type LeaderboardScope,
  type LeaderboardService,
  type LeaderboardWinEntry,
  type LeaderboardWinPage,
} from "../services/leaderboards/leaderboard-service.js";
import {
  calculateLeaderboardPeriod,
  calculateLeaderboardResetSchedule,
} from "../services/leaderboards/leaderboard-period.js";

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
  all_time_xp: string;
  record_start: string | null;
  record_end: string | null;
}

interface WinEntryRow {
  user_id: string;
  wins: string;
}

interface TotalsQuery {
  sql: string;
  parameters: unknown[];
}

function parseDatabaseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

function buildCurrentTotalsQuery(
  guildId: string,
  scope: LeaderboardScope,
  periodStart: string | null,
  periodEnd: string | null,
): TotalsQuery {
  if (scope === "all") {
    return {
      sql: `
        SELECT
          user_id,
          (legacy_xp_adjusted + new_bot_xp)::bigint AS xp,
          (legacy_xp_adjusted + new_bot_xp)::bigint AS all_time_xp,
          NULL::date AS record_start,
          NULL::date AS record_end
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
      WITH period_totals AS (
        SELECT user_id, SUM(amount)::bigint AS xp
        FROM daily_xp_totals
        WHERE guild_id = $1
          AND xp_date BETWEEN $2::date AND $3::date
        GROUP BY user_id
        HAVING SUM(amount) > 0
      )
      SELECT
        period_totals.user_id,
        period_totals.xp,
        (guild_members.legacy_xp_adjusted + guild_members.new_bot_xp)::bigint AS all_time_xp,
        NULL::date AS record_start,
        NULL::date AS record_end
      FROM period_totals
      INNER JOIN guild_members
        ON guild_members.guild_id = $1
        AND guild_members.user_id = period_totals.user_id
    `,
    parameters: [guildId, periodStart, periodEnd],
  };
}

function periodStartExpression(scope: LeaderboardRecordScope): string {
  switch (scope) {
    case "weekly":
      return "(xp_date - (EXTRACT(ISODOW FROM xp_date)::integer - 1))::date";
    case "monthly":
      return "date_trunc('month', xp_date::timestamp)::date";
    case "yearly":
      return "date_trunc('year', xp_date::timestamp)::date";
  }
}

function periodEndExpression(scope: LeaderboardRecordScope): string {
  switch (scope) {
    case "weekly":
      return "(best_periods.record_start + 6)::date";
    case "monthly":
      return "(best_periods.record_start + INTERVAL '1 month - 1 day')::date";
    case "yearly":
      return "(best_periods.record_start + INTERVAL '1 year - 1 day')::date";
  }
}

function buildRecordTotalsQuery(
  guildId: string,
  scope: LeaderboardRecordScope,
): TotalsQuery {
  const startExpression = periodStartExpression(scope);
  const endExpression = periodEndExpression(scope);

  return {
    sql: `
      WITH period_totals AS (
        SELECT
          user_id,
          ${startExpression} AS record_start,
          SUM(amount)::bigint AS xp
        FROM daily_xp_totals
        WHERE guild_id = $1
        GROUP BY user_id, ${startExpression}
        HAVING SUM(amount) > 0
      ),
      best_periods AS (
        SELECT
          user_id,
          record_start,
          xp,
          ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY xp DESC, record_start ASC
          ) AS record_order
        FROM period_totals
      )
      SELECT
        best_periods.user_id,
        best_periods.xp,
        (guild_members.legacy_xp_adjusted + guild_members.new_bot_xp)::bigint AS all_time_xp,
        best_periods.record_start,
        ${endExpression} AS record_end
      FROM best_periods
      INNER JOIN guild_members
        ON guild_members.guild_id = $1
        AND guild_members.user_id = best_periods.user_id
      WHERE best_periods.record_order = 1
    `,
    parameters: [guildId],
  };
}

function buildWinTotalsQuery(
  guildId: string,
  scope: LeaderboardRecordScope,
  currentPeriodStart: string,
): TotalsQuery {
  const startExpression = periodStartExpression(scope);

  return {
    sql: `
      WITH dated_totals AS (
        SELECT
          user_id,
          ${startExpression} AS period_start,
          amount
        FROM daily_xp_totals
        WHERE guild_id = $1
      ),
      period_totals AS (
        SELECT
          user_id,
          period_start,
          SUM(amount)::bigint AS xp
        FROM dated_totals
        WHERE period_start < $2::date
        GROUP BY user_id, period_start
        HAVING SUM(amount) > 0
      ),
      period_rankings AS (
        SELECT
          user_id,
          period_start,
          ROW_NUMBER() OVER (
            PARTITION BY period_start
            ORDER BY xp DESC, user_id ASC
          ) AS period_rank
        FROM period_totals
      )
      SELECT user_id, COUNT(*)::bigint AS wins
      FROM period_rankings
      WHERE period_rank = 1
      GROUP BY user_id
    `,
    parameters: [guildId, currentPeriodStart],
  };
}

export class PostgresLeaderboardService implements LeaderboardService {
  public constructor(
    private readonly pool: Pool,
    private readonly defaultTimezone: string,
  ) {}

  private async loadGuildSettings(guildId: string): Promise<GuildSettingsRow> {
    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id, timezone)
        VALUES ($1, $2)
        ON CONFLICT (guild_id) DO NOTHING
      `,
      [guildId, this.defaultTimezone],
    );

    const result = await this.pool.query<GuildSettingsRow>(
      `
        SELECT timezone, launched_at
        FROM guild_settings
        WHERE guild_id = $1
      `,
      [guildId],
    );
    const settings = result.rows[0];

    if (!settings) {
      throw new Error(`Guild settings are missing for ${guildId}.`);
    }

    return settings;
  }

  private async queryPage(input: {
    kind: LeaderboardPage["kind"];
    scope: LeaderboardScope;
    page: number;
    totals: TotalsQuery;
    timezone: string;
    periodStart: string | null;
    periodEnd: string | null;
    launchLimited: boolean;
    now: Date;
  }): Promise<LeaderboardPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      throw new RangeError("Leaderboard page must be a positive whole number.");
    }

    const countResult = await this.pool.query<CountRow>(
      `
        WITH leaderboard_totals AS (${input.totals.sql})
        SELECT COUNT(*)::text AS count
        FROM leaderboard_totals
      `,
      input.totals.parameters,
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
    const limitParameter = input.totals.parameters.length + 1;
    const offsetParameter = input.totals.parameters.length + 2;
    const entriesResult = await this.pool.query<EntryRow>(
      `
        WITH leaderboard_totals AS (${input.totals.sql})
        SELECT
          user_id,
          xp,
          all_time_xp,
          record_start::text AS record_start,
          record_end::text AS record_end
        FROM leaderboard_totals
        ORDER BY xp DESC, user_id ASC
        LIMIT $${limitParameter}
        OFFSET $${offsetParameter}
      `,
      [...input.totals.parameters, LEADERBOARD_PAGE_SIZE, offset],
    );
    const entries: LeaderboardEntry[] = entriesResult.rows.map((row, index) => ({
      rank: offset + index + 1,
      userId: row.user_id,
      xp: parseDatabaseInteger(row.xp, "leaderboard XP"),
      allTimeXp: parseDatabaseInteger(row.all_time_xp, "all-time XP"),
      recordStart: row.record_start,
      recordEnd: row.record_end,
    }));

    return {
      kind: input.kind,
      scope: input.scope,
      page,
      pageSize: LEADERBOARD_PAGE_SIZE,
      totalPages,
      participantCount,
      visibleEntryCount,
      entries,
      timezone: input.timezone,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      launchLimited: input.launchLimited,
      generatedAt: input.now,
    };
  }

  public async getPage(input: {
    guildId: string;
    scope: LeaderboardScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardPage> {
    const settings = await this.loadGuildSettings(input.guildId);
    const period = calculateLeaderboardPeriod({
      scope: input.scope,
      now: input.now,
      timezone: settings.timezone,
      launchedAt: settings.launched_at,
    });
    const totals = buildCurrentTotalsQuery(
      input.guildId,
      input.scope,
      period.startDate,
      period.endDate,
    );

    return this.queryPage({
      kind: "current",
      scope: input.scope,
      page: input.page,
      totals,
      timezone: settings.timezone,
      periodStart: period.displayStartDate,
      periodEnd: period.displayEndDate,
      launchLimited: period.launchLimited,
      now: input.now,
    });
  }

  public async getResetSchedule(input: {
    guildId: string;
    now: Date;
  }): Promise<LeaderboardResetSchedule> {
    const settings = await this.loadGuildSettings(input.guildId);

    return calculateLeaderboardResetSchedule({
      now: input.now,
      timezone: settings.timezone,
    });
  }

  public async getWinPage(input: {
    guildId: string;
    scope: LeaderboardRecordScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardWinPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      throw new RangeError("Leaderboard page must be a positive whole number.");
    }

    const settings = await this.loadGuildSettings(input.guildId);
    const period = calculateLeaderboardPeriod({
      scope: input.scope,
      now: input.now,
      timezone: settings.timezone,
      launchedAt: settings.launched_at,
    });

    if (!period.displayStartDate) {
      throw new Error(`Missing current ${input.scope} period boundary.`);
    }

    const totals = buildWinTotalsQuery(
      input.guildId,
      input.scope,
      period.displayStartDate,
    );
    const countResult = await this.pool.query<CountRow>(
      `
        WITH leaderboard_wins AS (${totals.sql})
        SELECT COUNT(*)::text AS count
        FROM leaderboard_wins
      `,
      totals.parameters,
    );
    const participantCount = parseDatabaseInteger(
      countResult.rows[0]?.count ?? "0",
      "wins leaderboard participant count",
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
    const entriesResult = await this.pool.query<WinEntryRow>(
      `
        WITH leaderboard_wins AS (${totals.sql})
        SELECT user_id, wins
        FROM leaderboard_wins
        ORDER BY wins DESC, user_id ASC
        LIMIT $3
        OFFSET $4
      `,
      [
        ...totals.parameters,
        LEADERBOARD_PAGE_SIZE,
        offset,
      ],
    );
    const entries: LeaderboardWinEntry[] = entriesResult.rows.map(
      (row, index) => ({
        rank: offset + index + 1,
        userId: row.user_id,
        wins: parseDatabaseInteger(row.wins, "leaderboard wins"),
      }),
    );

    return {
      scope: input.scope,
      page,
      pageSize: LEADERBOARD_PAGE_SIZE,
      totalPages,
      participantCount,
      visibleEntryCount,
      entries,
      timezone: settings.timezone,
      generatedAt: input.now,
    };
  }

  public async getRecordPage(input: {
    guildId: string;
    scope: LeaderboardRecordScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardPage> {
    const settings = await this.loadGuildSettings(input.guildId);

    return this.queryPage({
      kind: "record",
      scope: input.scope,
      page: input.page,
      totals: buildRecordTotalsQuery(input.guildId, input.scope),
      timezone: settings.timezone,
      periodStart: null,
      periodEnd: null,
      launchLimited: false,
      now: input.now,
    });
  }
}
