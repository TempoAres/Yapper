import type { Pool } from "pg";

import type {
  Reminder,
  ReminderService,
} from "../services/reminders/reminder-service.js";

interface ReminderRow {
  id: string;
  guild_id: string;
  user_id: string;
  channel_id: string;
  message: string;
  remind_at: Date;
  delivery_attempts: number;
}

function parseReminderId(value: string): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("Database reminder ID is outside JavaScript's safe range.");
  }

  return id;
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: parseReminderId(row.id),
    guildId: row.guild_id,
    userId: row.user_id,
    channelId: row.channel_id,
    message: row.message,
    remindAt: row.remind_at,
    deliveryAttempts: row.delivery_attempts,
  };
}

export class PostgresReminderService implements ReminderService {
  public constructor(private readonly pool: Pool) {}

  public async create(input: {
    guildId: string;
    userId: string;
    channelId: string;
    message: string;
    remindAt: Date;
  }): Promise<Reminder> {
    const message = input.message.trim();

    if (message.length < 1 || message.length > 500) {
      throw new RangeError("Reminder text must be between 1 and 500 characters.");
    }

    if (Number.isNaN(input.remindAt.getTime())) {
      throw new RangeError("Reminder time must be valid.");
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
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
        [input.guildId, input.userId],
      );
      const countResult = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM reminders
          WHERE guild_id = $1 AND user_id = $2 AND status = 'pending'
        `,
        [input.guildId, input.userId],
      );

      if (Number(countResult.rows[0]?.count ?? "0") >= 10) {
        throw new RangeError(
          "You can have at most 10 pending reminders in one server.",
        );
      }

      const result = await client.query<ReminderRow>(
        `
          INSERT INTO reminders (
            guild_id,
            user_id,
            channel_id,
            message,
            remind_at,
            next_attempt_at
          )
          VALUES ($1, $2, $3, $4, $5, $5)
          RETURNING
            id::text,
            guild_id,
            user_id,
            channel_id,
            message,
            remind_at,
            delivery_attempts
        `,
        [
          input.guildId,
          input.userId,
          input.channelId,
          message,
          input.remindAt,
        ],
      );
      await client.query("COMMIT");
      const reminder = result.rows[0];

      if (!reminder) {
        throw new Error("The reminder was not returned after creation.");
      }

      return toReminder(reminder);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async list(input: {
    guildId: string;
    userId: string;
    limit: number;
  }): Promise<readonly Reminder[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 25) {
      throw new RangeError("Reminder list limit must be from 1 to 25.");
    }

    const result = await this.pool.query<ReminderRow>(
      `
        SELECT
          id::text,
          guild_id,
          user_id,
          channel_id,
          message,
          remind_at,
          delivery_attempts
        FROM reminders
        WHERE guild_id = $1
          AND user_id = $2
          AND status = 'pending'
        ORDER BY remind_at ASC, id ASC
        LIMIT $3
      `,
      [input.guildId, input.userId, input.limit],
    );

    return result.rows.map(toReminder);
  }

  public async cancel(input: {
    guildId: string;
    userId: string;
    reminderId: number;
  }): Promise<boolean> {
    if (!Number.isSafeInteger(input.reminderId) || input.reminderId < 1) {
      throw new RangeError("Reminder ID must be a positive whole number.");
    }

    const result = await this.pool.query(
      `
        UPDATE reminders
        SET status = 'cancelled', cancelled_at = NOW()
        WHERE id = $1
          AND guild_id = $2
          AND user_id = $3
          AND status = 'pending'
      `,
      [input.reminderId, input.guildId, input.userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async claimDue(input: {
    now: Date;
    limit: number;
  }): Promise<readonly Reminder[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError("Reminder claim limit must be from 1 to 100.");
    }

    const result = await this.pool.query<ReminderRow>(
      `
        WITH due AS (
          SELECT id
          FROM reminders
          WHERE next_attempt_at <= $1
            AND (
              status = 'pending'
              OR (
                status = 'delivering'
                AND delivery_started_at <= $1 - INTERVAL '5 minutes'
              )
            )
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE reminders AS reminder
        SET
          status = 'delivering',
          delivery_attempts = reminder.delivery_attempts + 1,
          delivery_started_at = $1,
          last_error = NULL
        FROM due
        WHERE reminder.id = due.id
        RETURNING
          reminder.id::text,
          reminder.guild_id,
          reminder.user_id,
          reminder.channel_id,
          reminder.message,
          reminder.remind_at,
          reminder.delivery_attempts
      `,
      [input.now, input.limit],
    );

    return result.rows.map(toReminder);
  }

  public async markDelivered(reminderId: number, deliveredAt: Date): Promise<void> {
    await this.pool.query(
      `
        UPDATE reminders
        SET
          status = 'delivered',
          delivered_at = $2,
          delivery_started_at = NULL,
          last_error = NULL
        WHERE id = $1 AND status = 'delivering'
      `,
      [reminderId, deliveredAt],
    );
  }

  public async releaseForRetry(input: {
    reminderId: number;
    error: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE reminders
        SET
          status = 'pending',
          delivery_started_at = NULL,
          next_attempt_at = NOW() + make_interval(
            secs => LEAST(
              3600,
              15 * POWER(2, LEAST(delivery_attempts - 1, 8))::integer
            )
          ),
          last_error = LEFT($2, 500)
        WHERE id = $1 AND status = 'delivering'
      `,
      [input.reminderId, input.error],
    );
  }
}
