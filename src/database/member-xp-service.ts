import type { Pool } from "pg";

import type {
  MemberXpService,
  MemberXpStats,
} from "../services/xp/member-xp-service.js";

interface MemberXpRow {
  guild_id: string;
  user_id: string;
  legacy_xp_raw: string;
  legacy_xp_adjusted: string;
  new_bot_xp: string;
  all_time_xp: string;
  rank: string;
}

function parseDatabaseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

export class PostgresMemberXpService implements MemberXpService {
  public constructor(private readonly pool: Pool) {}

  public async getMemberStats(
    guildId: string,
    userId: string,
  ): Promise<MemberXpStats> {
    const result = await this.pool.query<MemberXpRow>(
      `
        WITH ranked_members AS (
          SELECT
            guild_id,
            user_id,
            legacy_xp_raw,
            legacy_xp_adjusted,
            new_bot_xp,
            legacy_xp_adjusted + new_bot_xp AS all_time_xp,
            RANK() OVER (
              ORDER BY legacy_xp_adjusted + new_bot_xp DESC, user_id ASC
            ) AS rank
          FROM guild_members
          WHERE guild_id = $1
            AND legacy_xp_adjusted + new_bot_xp > 0
        )
        SELECT *
        FROM ranked_members
        WHERE user_id = $2
      `,
      [guildId, userId],
    );

    const row = result.rows[0];

    if (!row) {
      return {
        guildId,
        userId,
        legacyXpRaw: 0,
        legacyXpAdjusted: 0,
        newBotXp: 0,
        allTimeXp: 0,
        rank: null,
      };
    }

    return {
      guildId: row.guild_id,
      userId: row.user_id,
      legacyXpRaw: parseDatabaseInteger(row.legacy_xp_raw, "legacy XP"),
      legacyXpAdjusted: parseDatabaseInteger(
        row.legacy_xp_adjusted,
        "adjusted legacy XP",
      ),
      newBotXp: parseDatabaseInteger(row.new_bot_xp, "Yapper XP"),
      allTimeXp: parseDatabaseInteger(row.all_time_xp, "all-time XP"),
      rank: parseDatabaseInteger(row.rank, "rank"),
    };
  }
}
