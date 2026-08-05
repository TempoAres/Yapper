import { PermissionFlagsBits, type GuildMember, type Role } from "discord.js";

import type { RoleRewardService } from "../services/roles/role-reward-service.js";
import {
  planStackedRoleSync,
  type RoleRewardCoordinator,
  type RoleSyncIssue,
  type RoleSyncResult,
} from "../services/roles/role-sync.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";
import type { MemberXpService } from "../services/xp/member-xp-service.js";

async function resolveRole(
  member: GuildMember,
  roleId: string,
): Promise<Role | null> {
  const cached = member.guild.roles.cache.get(roleId);

  if (cached) {
    return cached;
  }

  return member.guild.roles.fetch(roleId).catch(() => null);
}

export class DiscordRoleRewardCoordinator implements RoleRewardCoordinator {
  public constructor(
    private readonly rewards: RoleRewardService,
    private readonly memberXp: MemberXpService,
  ) {}

  public async syncMember(member: GuildMember): Promise<RoleSyncResult> {
    const [configuredRewards, stats] = await Promise.all([
      this.rewards.listRewards(member.guild.id),
      this.memberXp.getMemberStats(member.guild.id, member.id),
    ]);
    const level = calculateLevelProgress(stats.allTimeXp).level;
    const plan = planStackedRoleSync({
      rewards: configuredRewards,
      level,
      currentRoleIds: new Set(member.roles.cache.keys()),
    });
    const issues: RoleSyncIssue[] = [];
    const manageableRoleIds: string[] = [];

    if (plan.missing.length === 0) {
      return {
        level,
        configuredRoleCount: configuredRewards.length,
        earnedRoleIds: plan.earned.map((reward) => reward.roleId),
        existingRoleIds: plan.existing.map((reward) => reward.roleId),
        addedRoleIds: [],
        issues,
      };
    }

    const botMember =
      member.guild.members.me ?? (await member.guild.members.fetchMe());

    if (
      plan.missing.length > 0 &&
      !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
    ) {
      issues.push({
        code: "missing_manage_roles",
        roleId: null,
        message:
          "Yapper needs the Manage Roles permission before it can grant XP roles.",
      });
    } else {
      for (const reward of plan.missing) {
        const role = await resolveRole(member, reward.roleId);

        if (!role) {
          issues.push({
            code: "role_missing",
            roleId: reward.roleId,
            message: `Configured level ${reward.requiredLevel} role ${reward.roleId} no longer exists.`,
          });
          continue;
        }

        if (role.managed || role.id === member.guild.id) {
          issues.push({
            code: "managed_role",
            roleId: role.id,
            message: `${role.name} is managed by Discord or an integration and cannot be granted.`,
          });
          continue;
        }

        if (role.position >= botMember.roles.highest.position) {
          issues.push({
            code: "role_hierarchy",
            roleId: role.id,
            message: `${role.name} must be below Yapper's highest role in Server Settings -> Roles.`,
          });
          continue;
        }

        manageableRoleIds.push(role.id);
      }
    }

    const addedRoleIds: string[] = [];

    if (manageableRoleIds.length > 0) {
      try {
        await member.roles.add(
          manageableRoleIds,
          `Yapper stacked XP rewards through level ${level}`,
        );
        addedRoleIds.push(...manageableRoleIds);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        issues.push({
          code: "assignment_failed",
          roleId: null,
          message: `Discord rejected the role assignment: ${detail}`,
        });
      }
    }

    return {
      level,
      configuredRoleCount: configuredRewards.length,
      earnedRoleIds: plan.earned.map((reward) => reward.roleId),
      existingRoleIds: plan.existing.map((reward) => reward.roleId),
      addedRoleIds,
      issues,
    };
  }
}
