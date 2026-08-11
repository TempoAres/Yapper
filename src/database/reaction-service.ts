import type { Pool, PoolClient } from "pg";

import {
  REACTION_LEADERBOARD_MAX_ENTRIES,
  REACTION_LEADERBOARD_PAGE_SIZE,
  type AddReactionInput,
  type ReactionLeaderboardEntry,
  type ReactionLeaderboardMetric,
  type ReactionLeaderboardPage,
  type ReactionMembershipInput,
  type ReactionService,
} from "../services/reactions/reaction-service.js";

interface RemovedReactionRow {
  reactor_user_id: string;
  message_author_id: string;
}

interface CountRow {
  count: string;
}

interface LeaderboardRow {
  user_id: string;
  reaction_count: string;
}

function parseDatabaseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

async function decrementReactionTotals(
  client: PoolClient,
  guildId: string,
  column: "reactions_given" | "reactions_received",
  counts: ReadonlyMap<string, number>,
): Promise<void> {
  if (counts.size === 0) {
    return;
  }

  const userIds = [...counts.keys()];
  const amounts = userIds.map((userId) => counts.get(userId) ?? 0);
  await client.query(
    `
      UPDATE member_reaction_totals AS totals
      SET ${column} = GREATEST(totals.${column} - removed.amount, 0),
          updated_at = NOW()
      FROM UNNEST($2::text[], $3::bigint[]) AS removed(user_id, amount)
      WHERE totals.guild_id = $1 AND totals.user_id = removed.user_id
    `,
    [guildId, userIds, amounts],
  );
}

export class PostgresReactionService implements ReactionService {
  public constructor(private readonly pool: Pool) {}

  public async addReaction(
    input: AddReactionInput,
  ): Promise<{ applied: boolean }> {
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
      const inserted = await client.query(
        `
          INSERT INTO reaction_memberships (
            guild_id,
            message_id,
            emoji_key,
            reactor_user_id,
            message_author_id,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (guild_id, message_id, emoji_key, reactor_user_id)
          DO NOTHING
          RETURNING reactor_user_id
        `,
        [
          input.guildId,
          input.messageId,
          input.emojiKey,
          input.reactorUserId,
          input.messageAuthorId,
          input.createdAt,
        ],
      );

      if ((inserted.rowCount ?? 0) === 0) {
        await client.query("COMMIT");
        return { applied: false };
      }

      await client.query(
        `
          INSERT INTO member_reaction_totals (
            guild_id,
            user_id,
            reactions_given
          )
          VALUES ($1, $2, 1)
          ON CONFLICT (guild_id, user_id)
          DO UPDATE SET
            reactions_given = member_reaction_totals.reactions_given + 1,
            updated_at = NOW()
        `,
        [input.guildId, input.reactorUserId],
      );
      await client.query(
        `
          INSERT INTO member_reaction_totals (
            guild_id,
            user_id,
            reactions_received
          )
          VALUES ($1, $2, 1)
          ON CONFLICT (guild_id, user_id)
          DO UPDATE SET
            reactions_received = member_reaction_totals.reactions_received + 1,
            updated_at = NOW()
        `,
        [input.guildId, input.messageAuthorId],
      );
      await client.query("COMMIT");
      return { applied: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async removeReaction(
    input: ReactionMembershipInput,
  ): Promise<{ applied: boolean }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const removed = await client.query<RemovedReactionRow>(
        `
          DELETE FROM reaction_memberships
          WHERE guild_id = $1
            AND message_id = $2
            AND emoji_key = $3
            AND reactor_user_id = $4
          RETURNING reactor_user_id, message_author_id
        `,
        [
          input.guildId,
          input.messageId,
          input.emojiKey,
          input.reactorUserId,
        ],
      );
      const membership = removed.rows[0];

      if (!membership) {
        await client.query("COMMIT");
        return { applied: false };
      }

      await client.query(
        `
          UPDATE member_reaction_totals
          SET reactions_given = GREATEST(reactions_given - 1, 0),
              updated_at = NOW()
          WHERE guild_id = $1 AND user_id = $2
        `,
        [input.guildId, membership.reactor_user_id],
      );
      await client.query(
        `
          UPDATE member_reaction_totals
          SET reactions_received = GREATEST(reactions_received - 1, 0),
              updated_at = NOW()
          WHERE guild_id = $1 AND user_id = $2
        `,
        [input.guildId, membership.message_author_id],
      );
      await client.query("COMMIT");
      return { applied: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async clearReactions(input: {
    guildId: string;
    messageId: string;
    emojiKey?: string;
  }): Promise<{ removedCount: number }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const removed = await client.query<RemovedReactionRow>(
        `
          DELETE FROM reaction_memberships
          WHERE guild_id = $1
            AND message_id = $2
            AND ($3::text IS NULL OR emoji_key = $3)
          RETURNING reactor_user_id, message_author_id
        `,
        [input.guildId, input.messageId, input.emojiKey ?? null],
      );
      const given = new Map<string, number>();
      const received = new Map<string, number>();

      for (const membership of removed.rows) {
        given.set(
          membership.reactor_user_id,
          (given.get(membership.reactor_user_id) ?? 0) + 1,
        );
        received.set(
          membership.message_author_id,
          (received.get(membership.message_author_id) ?? 0) + 1,
        );
      }

      await decrementReactionTotals(
        client,
        input.guildId,
        "reactions_given",
        given,
      );
      await decrementReactionTotals(
        client,
        input.guildId,
        "reactions_received",
        received,
      );
      await client.query("COMMIT");
      return { removedCount: removed.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getLeaderboardPage(input: {
    guildId: string;
    metric: ReactionLeaderboardMetric;
    page: number;
    now: Date;
  }): Promise<ReactionLeaderboardPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      throw new RangeError(
        "Reaction leaderboard page must be a positive whole number.",
      );
    }

    const column =
      input.metric === "received" ? "reactions_received" : "reactions_given";
    const countResult = await this.pool.query<CountRow>(
      `
        SELECT COUNT(*)::text AS count
        FROM member_reaction_totals
        WHERE guild_id = $1 AND ${column} > 0
      `,
      [input.guildId],
    );
    const participantCount = parseDatabaseInteger(
      countResult.rows[0]?.count ?? "0",
      "reaction leaderboard participant count",
    );
    const visibleEntryCount = Math.min(
      participantCount,
      REACTION_LEADERBOARD_MAX_ENTRIES,
    );
    const totalPages = Math.max(
      1,
      Math.ceil(visibleEntryCount / REACTION_LEADERBOARD_PAGE_SIZE),
    );
    const page = Math.min(input.page, totalPages);
    const offset = (page - 1) * REACTION_LEADERBOARD_PAGE_SIZE;
    const result = await this.pool.query<LeaderboardRow>(
      `
        SELECT user_id, ${column}::text AS reaction_count
        FROM member_reaction_totals
        WHERE guild_id = $1 AND ${column} > 0
        ORDER BY ${column} DESC, user_id ASC
        LIMIT $2 OFFSET $3
      `,
      [input.guildId, REACTION_LEADERBOARD_PAGE_SIZE, offset],
    );
    const entries: ReactionLeaderboardEntry[] = result.rows.map(
      (row, index) => ({
        rank: offset + index + 1,
        userId: row.user_id,
        count: parseDatabaseInteger(row.reaction_count, "reaction count"),
      }),
    );

    return {
      metric: input.metric,
      page,
      pageSize: REACTION_LEADERBOARD_PAGE_SIZE,
      totalPages,
      participantCount,
      visibleEntryCount,
      entries,
      generatedAt: input.now,
    };
  }
}
