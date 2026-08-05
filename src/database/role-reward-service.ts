import type { Pool } from "pg";

import type {
  AddRoleRewardResult,
  RoleRewardService,
  XpRoleReward,
} from "../services/roles/role-reward-service.js";

interface RewardRow {
  guild_id: string;
  role_id: string;
  required_level: number;
}

function mapReward(row: RewardRow): XpRoleReward {
  return {
    guildId: row.guild_id,
    roleId: row.role_id,
    requiredLevel: row.required_level,
  };
}

function validateReward(input: XpRoleReward): void {
  if (!Number.isSafeInteger(input.requiredLevel) || input.requiredLevel < 0) {
    throw new RangeError("Required role level must be a non-negative integer.");
  }
}

export class PostgresRoleRewardService implements RoleRewardService {
  public constructor(private readonly pool: Pool) {}

  public async addReward(input: XpRoleReward): Promise<AddRoleRewardResult> {
    validateReward(input);
    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id)
        VALUES ($1)
        ON CONFLICT (guild_id) DO NOTHING
      `,
      [input.guildId],
    );
    const insertResult = await this.pool.query<RewardRow>(
      `
        INSERT INTO xp_role_rewards (guild_id, required_level, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        RETURNING guild_id, required_level, role_id
      `,
      [input.guildId, input.requiredLevel, input.roleId],
    );
    const created = insertResult.rows[0];

    if (created) {
      return { status: "created", reward: mapReward(created) };
    }

    const conflictResult = await this.pool.query<RewardRow>(
      `
        SELECT guild_id, required_level, role_id
        FROM xp_role_rewards
        WHERE guild_id = $1
          AND (required_level = $2 OR role_id = $3)
        ORDER BY required_level
        LIMIT 1
      `,
      [input.guildId, input.requiredLevel, input.roleId],
    );
    const conflict = conflictResult.rows[0];

    if (!conflict) {
      throw new Error("Role reward conflicted but the existing row was not found.");
    }

    return {
      status:
        conflict.required_level === input.requiredLevel
          ? "level_conflict"
          : "role_conflict",
      reward: mapReward(conflict),
    };
  }

  public async removeReward(
    guildId: string,
    requiredLevel: number,
  ): Promise<XpRoleReward | null> {
    if (!Number.isSafeInteger(requiredLevel) || requiredLevel < 0) {
      throw new RangeError("Required role level must be a non-negative integer.");
    }

    const result = await this.pool.query<RewardRow>(
      `
        DELETE FROM xp_role_rewards
        WHERE guild_id = $1 AND required_level = $2
        RETURNING guild_id, required_level, role_id
      `,
      [guildId, requiredLevel],
    );
    return result.rows[0] ? mapReward(result.rows[0]) : null;
  }

  public async listRewards(guildId: string): Promise<readonly XpRoleReward[]> {
    const result = await this.pool.query<RewardRow>(
      `
        SELECT guild_id, required_level, role_id
        FROM xp_role_rewards
        WHERE guild_id = $1
        ORDER BY required_level, role_id
      `,
      [guildId],
    );
    return result.rows.map(mapReward);
  }
}
