import type { Pool } from "pg";

import type {
  RecentXpEntry,
  RecentXpService,
} from "../services/xp/recent-xp-service.js";
import type { XpSource } from "../services/xp/xp-service.js";

interface RecentXpRow {
  channel_id: string | null;
  message_id: string | null;
  amount: string;
  source: XpSource;
  actor_user_id: string | null;
  note: string | null;
  created_at: Date;
}

function parseSignedDatabaseInteger(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Recent XP amount is outside JavaScript's safe range.");
  }

  return parsed;
}

export class PostgresRecentXpService implements RecentXpService {
  public constructor(private readonly pool: Pool) {}

  public async getRecent(input: {
    guildId: string;
    userId: string;
    limit: number;
  }): Promise<readonly RecentXpEntry[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 25) {
      throw new RangeError("Recent XP limit must be between 1 and 25.");
    }

    const result = await this.pool.query<RecentXpRow>(
      `
        SELECT
          channel_id,
          message_id,
          amount,
          source,
          actor_user_id,
          note,
          created_at
        FROM (
          SELECT
            channel_id,
            message_id,
            amount::bigint AS amount,
            source::text AS source,
            NULL::text AS actor_user_id,
            NULL::text AS note,
            created_at,
            id,
            0 AS record_kind
          FROM xp_events
          WHERE guild_id = $1 AND user_id = $2

          UNION ALL

          SELECT
            channel_id,
            NULL::text AS message_id,
            (new_new_bot_xp - previous_new_bot_xp)::bigint AS amount,
            'admin'::text AS source,
            moderator_user_id AS actor_user_id,
            reason AS note,
            created_at,
            id,
            1 AS record_kind
          FROM xp_admin_audit
          WHERE guild_id = $1 AND target_user_id = $2
        ) AS recent_records
        ORDER BY created_at DESC, record_kind DESC, id DESC
        LIMIT $3
      `,
      [input.guildId, input.userId, input.limit],
    );

    return result.rows.map((row) => ({
      amount: parseSignedDatabaseInteger(row.amount),
      source: row.source,
      channelId: row.channel_id,
      messageId: row.message_id,
      actorUserId: row.actor_user_id,
      note: row.note,
      createdAt: row.created_at,
    }));
  }
}
