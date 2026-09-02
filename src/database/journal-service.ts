import type { Pool } from "pg";

import type {
  JournalMessage,
  JournalService,
  JournalSession,
  JournalStatus,
} from "../services/journal/journal-service.js";

interface JournalSessionRow {
  id: string;
  guild_id: string;
  user_id: string;
  status: JournalStatus;
  started_at: Date;
  ends_at: Date;
  summary_text: string | null;
  message_count: string;
  delivery_attempts: number;
}

interface JournalMessageRow {
  message_id: string;
  channel_id: string;
  channel_name: string;
  content: string;
  created_at: Date;
}

function parseDatabaseId(value: string): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("Database journal ID is outside JavaScript's safe range.");
  }

  return id;
}

function toSession(row: JournalSessionRow): JournalSession {
  return {
    id: parseDatabaseId(row.id),
    guildId: row.guild_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    summaryText: row.summary_text ?? undefined,
    messageCount: Number(row.message_count),
    deliveryAttempts: row.delivery_attempts,
  };
}

const sessionSelection = `
  SELECT
    session.id::text,
    session.guild_id,
    session.user_id,
    session.status,
    session.started_at,
    session.ends_at,
    session.summary_text,
    COUNT(message.message_id)::text AS message_count,
    session.delivery_attempts
  FROM personal_journal_sessions AS session
  LEFT JOIN personal_journal_messages AS message
    ON message.session_id = session.id
`;

export class PostgresJournalService implements JournalService {
  public constructor(private readonly pool: Pool) {}

  public async start(input: {
    guildId: string;
    userId: string;
    startedAt: Date;
    endsAt: Date;
  }): Promise<JournalSession> {
    if (
      Number.isNaN(input.startedAt.getTime()) ||
      Number.isNaN(input.endsAt.getTime()) ||
      input.endsAt.getTime() <= input.startedAt.getTime()
    ) {
      throw new RangeError("Journal start and end times must form a valid window.");
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
        "SELECT pg_advisory_xact_lock(hashtextextended('journal:' || $1 || ':' || $2, 0))",
        [input.guildId, input.userId],
      );
      const existing = await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM personal_journal_sessions
          WHERE guild_id = $1
            AND user_id = $2
            AND status IN ('active', 'summarizing', 'awaiting_delivery')
          LIMIT 1
        `,
        [input.guildId, input.userId],
      );

      if (existing.rows[0]) {
        throw new RangeError("A personal journal is already active or being delivered.");
      }

      const result = await client.query<JournalSessionRow>(
        `
          INSERT INTO personal_journal_sessions (
            guild_id,
            user_id,
            started_at,
            ends_at,
            next_attempt_at
          )
          VALUES ($1, $2, $3, $4, $4)
          RETURNING
            id::text,
            guild_id,
            user_id,
            status,
            started_at,
            ends_at,
            summary_text,
            '0'::text AS message_count,
            delivery_attempts
        `,
        [input.guildId, input.userId, input.startedAt, input.endsAt],
      );
      await client.query("COMMIT");
      const session = result.rows[0];

      if (!session) {
        throw new Error("The journal session was not returned after creation.");
      }

      return toSession(session);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getCurrent(input: {
    guildId: string;
    userId: string;
  }): Promise<JournalSession | undefined> {
    const result = await this.pool.query<JournalSessionRow>(
      `${sessionSelection}
       WHERE session.guild_id = $1
         AND session.user_id = $2
         AND session.status IN ('active', 'summarizing', 'awaiting_delivery')
       GROUP BY session.id
       LIMIT 1`,
      [input.guildId, input.userId],
    );

    const row = result.rows[0];
    return row ? toSession(row) : undefined;
  }

  public async finishNow(input: {
    guildId: string;
    userId: string;
    now: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE personal_journal_sessions
        SET ends_at = $3, next_attempt_at = $3
        WHERE guild_id = $1
          AND user_id = $2
          AND status = 'active'
          AND started_at < $3
      `,
      [input.guildId, input.userId, input.now],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async cancel(input: {
    guildId: string;
    userId: string;
  }): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `
          UPDATE personal_journal_sessions
          SET
            status = 'cancelled',
            cancelled_at = NOW(),
            summary_text = NULL,
            delivery_started_at = NULL,
            last_error = NULL
          WHERE guild_id = $1
            AND user_id = $2
            AND status IN ('active', 'summarizing', 'awaiting_delivery')
          RETURNING id::text
        `,
        [input.guildId, input.userId],
      );
      const row = result.rows[0];

      if (row) {
        await client.query(
          "DELETE FROM personal_journal_messages WHERE session_id = $1",
          [row.id],
        );
      }

      await client.query("COMMIT");
      return Boolean(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async recordMessage(input: {
    guildId: string;
    userId: string;
    messageId: string;
    channelId: string;
    channelName: string;
    content: string;
    createdAt: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `
        INSERT INTO personal_journal_messages (
          session_id,
          message_id,
          channel_id,
          channel_name,
          content,
          created_at
        )
        SELECT id, $3, $4, $5, $6, $7
        FROM personal_journal_sessions
        WHERE guild_id = $1
          AND user_id = $2
          AND status = 'active'
          AND started_at <= $7
          AND ends_at > $7
        ON CONFLICT (session_id, message_id) DO NOTHING
      `,
      [
        input.guildId,
        input.userId,
        input.messageId,
        input.channelId,
        input.channelName,
        input.content,
        input.createdAt,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async claimDue(input: {
    now: Date;
    limit: number;
  }): Promise<readonly JournalSession[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 25) {
      throw new RangeError("Journal claim limit must be from 1 to 25.");
    }

    const result = await this.pool.query<JournalSessionRow>(
      `
        WITH due AS (
          SELECT id
          FROM personal_journal_sessions
          WHERE next_attempt_at <= $1
            AND (
              (status = 'active' AND ends_at <= $1)
              OR status = 'awaiting_delivery'
              OR (
                status = 'summarizing'
                AND delivery_started_at <= $1 - INTERVAL '5 minutes'
              )
            )
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        ), claimed AS (
          UPDATE personal_journal_sessions AS session
          SET
            status = 'summarizing',
            delivery_attempts = session.delivery_attempts + 1,
            delivery_started_at = $1,
            last_error = NULL
          FROM due
          WHERE session.id = due.id
          RETURNING session.*
        )
        SELECT
          claimed.id::text,
          claimed.guild_id,
          claimed.user_id,
          claimed.status,
          claimed.started_at,
          claimed.ends_at,
          claimed.summary_text,
          COUNT(message.message_id)::text AS message_count,
          claimed.delivery_attempts
        FROM claimed
        LEFT JOIN personal_journal_messages AS message
          ON message.session_id = claimed.id
        GROUP BY
          claimed.id,
          claimed.guild_id,
          claimed.user_id,
          claimed.status,
          claimed.started_at,
          claimed.ends_at,
          claimed.summary_text,
          claimed.delivery_attempts
      `,
      [input.now, input.limit],
    );

    return result.rows.map(toSession);
  }

  public async listMessages(
    sessionId: number,
  ): Promise<readonly JournalMessage[]> {
    const result = await this.pool.query<JournalMessageRow>(
      `
        SELECT message_id, channel_id, channel_name, content, created_at
        FROM personal_journal_messages
        WHERE session_id = $1
        ORDER BY created_at ASC, message_id ASC
      `,
      [sessionId],
    );

    return result.rows.map((row) => ({
      messageId: row.message_id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  public async saveSummary(sessionId: number, summaryText: string): Promise<void> {
    const result = await this.pool.query(
      `
        UPDATE personal_journal_sessions
        SET
          status = 'awaiting_delivery',
          summary_text = $2,
          delivery_started_at = NULL,
          next_attempt_at = NOW()
        WHERE id = $1 AND status = 'summarizing'
      `,
      [sessionId, summaryText],
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Journal session is no longer available for summarization.");
    }
  }

  public async markDelivered(sessionId: number, deliveredAt: Date): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          UPDATE personal_journal_sessions
          SET
            status = 'delivered',
            delivered_at = $2,
            summary_text = NULL,
            delivery_started_at = NULL,
            last_error = NULL
          WHERE id = $1 AND status IN ('summarizing', 'awaiting_delivery')
        `,
        [sessionId, deliveredAt],
      );

      if ((result.rowCount ?? 0) === 0) {
        throw new Error("Journal session is no longer available for delivery.");
      }

      await client.query(
        "DELETE FROM personal_journal_messages WHERE session_id = $1",
        [sessionId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async releaseForRetry(input: {
    sessionId: number;
    error: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE personal_journal_sessions
        SET
          status = CASE
            WHEN summary_text IS NULL THEN 'active'
            ELSE 'awaiting_delivery'
          END,
          delivery_started_at = NULL,
          next_attempt_at = NOW() + make_interval(
            secs => LEAST(
              3600,
              30 * POWER(2, LEAST(delivery_attempts - 1, 7))::integer
            )
          ),
          last_error = LEFT($2, 500)
        WHERE id = $1 AND status = 'summarizing'
      `,
      [input.sessionId, input.error],
    );
  }
}
