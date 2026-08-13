import type { Pool } from "pg";

import type {
  LeaderboardAnnouncementDelivery,
  LeaderboardAnnouncementDeliveryService,
} from "../services/leaderboards/leaderboard-announcement-service.js";

export class PostgresLeaderboardAnnouncementDeliveryService
  implements LeaderboardAnnouncementDeliveryService
{
  public constructor(private readonly pool: Pool) {}

  public async claim(
    input: LeaderboardAnnouncementDelivery & { now: Date },
  ): Promise<boolean> {
    await this.pool.query(
      `
        INSERT INTO leaderboard_announcement_deliveries (
          guild_id,
          scope,
          reset_at
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (guild_id, scope, reset_at) DO NOTHING
      `,
      [input.guildId, input.scope, input.resetAt],
    );
    const result = await this.pool.query(
      `
        UPDATE leaderboard_announcement_deliveries
        SET
          status = 'delivering',
          delivery_attempts = delivery_attempts + 1,
          delivery_started_at = $4::timestamptz,
          last_error = NULL
        WHERE guild_id = $1
          AND scope = $2
          AND reset_at = $3
          AND (
            status = 'pending'
            OR (
              status = 'delivering'
              AND delivery_started_at <=
                $4::timestamptz - INTERVAL '30 seconds'
            )
          )
      `,
      [input.guildId, input.scope, input.resetAt, input.now],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markDelivered(
    input: LeaderboardAnnouncementDelivery & { deliveredAt: Date },
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE leaderboard_announcement_deliveries
        SET
          status = 'delivered',
          delivery_started_at = NULL,
          delivered_at = $4,
          last_error = NULL
        WHERE guild_id = $1
          AND scope = $2
          AND reset_at = $3
          AND status = 'delivering'
      `,
      [input.guildId, input.scope, input.resetAt, input.deliveredAt],
    );
  }

  public async releaseForRetry(
    input: LeaderboardAnnouncementDelivery & { error: string },
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE leaderboard_announcement_deliveries
        SET
          status = 'pending',
          delivery_started_at = NULL,
          last_error = LEFT($4, 500)
        WHERE guild_id = $1
          AND scope = $2
          AND reset_at = $3
          AND status = 'delivering'
      `,
      [input.guildId, input.scope, input.resetAt, input.error],
    );
  }
}
