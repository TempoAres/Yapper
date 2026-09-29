import type { Pool } from "pg";

import {
  AFK_CLEAR_GRACE_MILLISECONDS,
  normalizeAfkReason,
  type AfkService,
  type AfkStatus,
  type SetAfkInput,
} from "../services/afk/afk-service.js";

interface AfkRow {
  guild_id: string;
  user_id: string;
  reason: string;
  set_at: Date;
  clear_after: Date;
  original_nickname: string | null;
  applied_nickname: string | null;
}

function mapAfkStatus(row: AfkRow): AfkStatus {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    reason: row.reason,
    setAt: row.set_at,
    clearAfter: row.clear_after,
    originalNickname: row.original_nickname,
    appliedNickname: row.applied_nickname,
  };
}

const afkColumns = `
  guild_id,
  user_id,
  reason,
  set_at,
  clear_after,
  original_nickname,
  applied_nickname
`;

export class PostgresAfkService implements AfkService {
  public constructor(private readonly pool: Pool) {}

  public async setAfk(input: SetAfkInput): Promise<AfkStatus> {
    const reason = normalizeAfkReason(input.reason);
    const clearAfter = new Date(
      input.setAt.getTime() + AFK_CLEAR_GRACE_MILLISECONDS,
    );

    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id)
        VALUES ($1)
        ON CONFLICT (guild_id) DO NOTHING
      `,
      [input.guildId],
    );
    const result = await this.pool.query<AfkRow>(
      `
        INSERT INTO afk_statuses (
          guild_id,
          user_id,
          reason,
          set_at,
          clear_after,
          original_nickname,
          applied_nickname
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET
          reason = EXCLUDED.reason,
          set_at = EXCLUDED.set_at,
          clear_after = EXCLUDED.clear_after,
          original_nickname = EXCLUDED.original_nickname,
          applied_nickname = EXCLUDED.applied_nickname
        RETURNING ${afkColumns}
      `,
      [
        input.guildId,
        input.userId,
        reason,
        input.setAt,
        clearAfter,
        input.originalNickname,
        input.appliedNickname,
      ],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("The AFK status was saved but could not be returned.");
    }

    return mapAfkStatus(row);
  }

  public async getAfk(
    guildId: string,
    userId: string,
  ): Promise<AfkStatus | undefined> {
    const result = await this.pool.query<AfkRow>(
      `
        SELECT ${afkColumns}
        FROM afk_statuses
        WHERE guild_id = $1 AND user_id = $2
      `,
      [guildId, userId],
    );
    return result.rows[0] ? mapAfkStatus(result.rows[0]) : undefined;
  }

  public async getAfkForUsers(
    guildId: string,
    userIds: readonly string[],
  ): Promise<readonly AfkStatus[]> {
    if (userIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<AfkRow>(
      `
        SELECT ${afkColumns}
        FROM afk_statuses
        WHERE guild_id = $1 AND user_id = ANY($2::text[])
      `,
      [guildId, userIds],
    );
    const statuses = new Map(
      result.rows.map((row) => [row.user_id, mapAfkStatus(row)]),
    );
    return userIds.flatMap((userId) => {
      const status = statuses.get(userId);
      return status ? [status] : [];
    });
  }

  public async clearAfkIfReady(
    guildId: string,
    userId: string,
    now: Date,
  ): Promise<AfkStatus | undefined> {
    const result = await this.pool.query<AfkRow>(
      `
        DELETE FROM afk_statuses
        WHERE guild_id = $1
          AND user_id = $2
          AND clear_after <= $3
        RETURNING ${afkColumns}
      `,
      [guildId, userId, now],
    );
    return result.rows[0] ? mapAfkStatus(result.rows[0]) : undefined;
  }
}
