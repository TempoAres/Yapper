import type { Pool, PoolClient } from "pg";

import {
  calculateAdminXpAdjustment,
  type AdminXpAdjustmentInput,
  type AdminXpAdjustmentResult,
  type AdminXpService,
} from "../services/xp/admin-xp-service.js";

interface MemberRow {
  new_bot_xp: string;
}

interface AuditRow {
  previous_new_bot_xp: string;
  new_new_bot_xp: string;
}

function parseDatabaseInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

async function findExistingAdjustment(
  client: PoolClient,
  guildId: string,
  discordInteractionId: string,
): Promise<AdminXpAdjustmentResult | null> {
  const result = await client.query<AuditRow>(
    `
      SELECT previous_new_bot_xp, new_new_bot_xp
      FROM xp_admin_audit
      WHERE guild_id = $1
        AND discord_interaction_id = $2
    `,
    [guildId, discordInteractionId],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const previousXp = parseDatabaseInteger(
    row.previous_new_bot_xp,
    "previous Yapper XP",
  );
  const newXp = parseDatabaseInteger(row.new_new_bot_xp, "new Yapper XP");

  return {
    status: "duplicate",
    previousXp,
    newXp,
    delta: newXp - previousXp,
  };
}

export class PostgresAdminXpService implements AdminXpService {
  public constructor(private readonly pool: Pool) {}

  public async adjust(
    input: AdminXpAdjustmentInput,
  ): Promise<AdminXpAdjustmentResult> {
    const reason = input.reason?.trim() || null;

    if (reason && reason.length > 200) {
      throw new RangeError("Admin XP reasons cannot exceed 200 characters.");
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
        `
          INSERT INTO guild_members (guild_id, user_id)
          VALUES ($1, $2)
          ON CONFLICT (guild_id, user_id) DO NOTHING
        `,
        [input.guildId, input.targetUserId],
      );
      const memberResult = await client.query<MemberRow>(
        `
          SELECT new_bot_xp
          FROM guild_members
          WHERE guild_id = $1 AND user_id = $2
          FOR UPDATE
        `,
        [input.guildId, input.targetUserId],
      );
      const member = memberResult.rows[0];

      if (!member) {
        throw new Error(`Could not lock member ${input.targetUserId}.`);
      }

      const existing = await findExistingAdjustment(
        client,
        input.guildId,
        input.discordInteractionId,
      );

      if (existing) {
        await client.query("COMMIT");
        return existing;
      }

      const calculation = calculateAdminXpAdjustment(
        parseDatabaseInteger(member.new_bot_xp, "Yapper XP"),
        input.operation,
        input.amount,
      );

      if (calculation.status !== "applied") {
        await client.query("COMMIT");
        return calculation;
      }

      await client.query(
        `
          UPDATE guild_members
          SET new_bot_xp = $3, updated_at = NOW()
          WHERE guild_id = $1 AND user_id = $2
        `,
        [input.guildId, input.targetUserId, calculation.newXp],
      );
      await client.query(
        `
          INSERT INTO xp_admin_audit (
            guild_id,
            target_user_id,
            moderator_user_id,
            channel_id,
            discord_interaction_id,
            operation,
            requested_amount,
            previous_new_bot_xp,
            new_new_bot_xp,
            reason,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          input.guildId,
          input.targetUserId,
          input.moderatorUserId,
          input.channelId,
          input.discordInteractionId,
          input.operation,
          input.amount,
          calculation.previousXp,
          calculation.newXp,
          reason,
          input.createdAt,
        ],
      );
      await client.query("COMMIT");
      return calculation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
