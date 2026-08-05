import type { Pool } from "pg";

import type {
  AwardXpInput,
  XpService,
} from "../services/xp/xp-service.js";

export class PostgresXpService implements XpService {
  public constructor(private readonly pool: Pool) {}

  public async award(input: AwardXpInput): Promise<{ awarded: boolean }> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new RangeError("XP amount must be a positive safe integer.");
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

      const insertedEvent = await client.query(
        `
          INSERT INTO xp_events (
            guild_id,
            user_id,
            channel_id,
            message_id,
            discord_event_id,
            amount,
            source,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (guild_id, discord_event_id) DO NOTHING
          RETURNING id
        `,
        [
          input.guildId,
          input.userId,
          input.channelId,
          input.messageId,
          input.discordEventId,
          input.amount,
          input.source,
          input.createdAt,
        ],
      );

      if ((insertedEvent.rowCount ?? 0) === 0) {
        await client.query("COMMIT");
        return { awarded: false };
      }

      await client.query(
        `
          INSERT INTO guild_members (guild_id, user_id, new_bot_xp)
          VALUES ($1, $2, $3)
          ON CONFLICT (guild_id, user_id)
          DO UPDATE SET
            new_bot_xp = guild_members.new_bot_xp + EXCLUDED.new_bot_xp,
            updated_at = NOW()
        `,
        [input.guildId, input.userId, input.amount],
      );

      await client.query(
        `
          INSERT INTO daily_xp_totals (guild_id, user_id, xp_date, amount)
          SELECT
            $1,
            $2,
            ($3::timestamptz AT TIME ZONE timezone)::date,
            $4
          FROM guild_settings
          WHERE guild_id = $1
          ON CONFLICT (guild_id, user_id, xp_date)
          DO UPDATE SET amount = daily_xp_totals.amount + EXCLUDED.amount
        `,
        [input.guildId, input.userId, input.createdAt, input.amount],
      );

      await client.query("COMMIT");
      return { awarded: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
