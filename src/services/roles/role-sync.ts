import type { GuildMember } from "discord.js";

import type { XpRoleReward } from "./role-reward-service.js";

export type RoleSyncIssueCode =
  | "missing_manage_roles"
  | "role_missing"
  | "managed_role"
  | "role_hierarchy"
  | "assignment_failed";

export interface RoleSyncIssue {
  code: RoleSyncIssueCode;
  roleId: string | null;
  message: string;
}

export interface RoleSyncResult {
  level: number;
  configuredRoleCount: number;
  earnedRoleIds: readonly string[];
  existingRoleIds: readonly string[];
  addedRoleIds: readonly string[];
  issues: readonly RoleSyncIssue[];
}

export interface RoleSyncPlan {
  earned: readonly XpRoleReward[];
  existing: readonly XpRoleReward[];
  missing: readonly XpRoleReward[];
}

export function planStackedRoleSync(input: {
  rewards: readonly XpRoleReward[];
  level: number;
  currentRoleIds: ReadonlySet<string>;
}): RoleSyncPlan {
  if (!Number.isSafeInteger(input.level) || input.level < 0) {
    throw new RangeError("Member level must be a non-negative whole number.");
  }

  const earned = [...input.rewards]
    .filter((reward) => reward.requiredLevel <= input.level)
    .sort((left, right) => left.requiredLevel - right.requiredLevel);
  const existing = earned.filter((reward) =>
    input.currentRoleIds.has(reward.roleId),
  );
  const missing = earned.filter(
    (reward) => !input.currentRoleIds.has(reward.roleId),
  );

  return { earned, existing, missing };
}

export interface RoleRewardCoordinator {
  syncMember(member: GuildMember): Promise<RoleSyncResult>;
}
