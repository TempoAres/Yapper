import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Role,
} from "discord.js";

import type { RoleRewardService, XpRoleReward } from "../services/roles/role-reward-service.js";
import {
  planStackedRoleSync,
  type GuildRoleSyncProgress,
  type GuildRoleSyncResult,
  type RoleRewardCoordinator,
  type RoleSyncIssue,
  type RoleSyncResult,
} from "../services/roles/role-sync.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";
import type { MemberXpService } from "../services/xp/member-xp-service.js";

const BULK_SYNC_WORKER_COUNT = 2;
const MAX_REPORTED_BULK_ISSUES = 20;

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

function createEmptyGuildResult(
  configuredRoleCount: number,
): GuildRoleSyncResult {
  return {
    status: "completed",
    configuredRoleCount,
    totalXpMemberCount: 0,
    processedXpMemberCount: 0,
    updatedMemberCount: 0,
    grantedRoleCount: 0,
    failedMemberCount: 0,
    alreadyCurrentMemberCount: 0,
    belowFirstRewardMemberCount: 0,
    departedMemberCount: 0,
    botMemberCount: 0,
    issues: [],
  };
}

export class DiscordRoleRewardCoordinator implements RoleRewardCoordinator {
  public constructor(
    private readonly rewards: RoleRewardService,
    private readonly memberXp: MemberXpService,
  ) {}

  private async syncMemberWithXp(
    member: GuildMember,
    configuredRewards: readonly XpRoleReward[],
    allTimeXp: number,
  ): Promise<RoleSyncResult> {
    const level = calculateLevelProgress(allTimeXp).level;
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

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
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

  private async validateGuildConfiguration(
    guild: Guild,
    configuredRewards: readonly XpRoleReward[],
  ): Promise<readonly RoleSyncIssue[]> {
    const issues: RoleSyncIssue[] = [];
    const botMember = guild.members.me ?? (await guild.members.fetchMe());

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      issues.push({
        code: "missing_manage_roles",
        roleId: null,
        message:
          "Yapper needs the Manage Roles permission before it can grant XP roles.",
      });
      return issues;
    }

    const roles = await guild.roles.fetch();

    for (const reward of configuredRewards) {
      const role = roles.get(reward.roleId);

      if (!role) {
        issues.push({
          code: "role_missing",
          roleId: reward.roleId,
          message: `The configured level ${reward.requiredLevel} role no longer exists.`,
        });
      } else if (role.managed || role.id === guild.id) {
        issues.push({
          code: "managed_role",
          roleId: role.id,
          message: `${role.name} is managed by Discord or an integration.`,
        });
      } else if (role.position >= botMember.roles.highest.position) {
        issues.push({
          code: "role_hierarchy",
          roleId: role.id,
          message: `${role.name} must be below Yapper's highest role.`,
        });
      }
    }

    return issues;
  }

  public async syncMember(member: GuildMember): Promise<RoleSyncResult> {
    const [configuredRewards, stats] = await Promise.all([
      this.rewards.listRewards(member.guild.id),
      this.memberXp.getMemberStats(member.guild.id, member.id),
    ]);

    return this.syncMemberWithXp(member, configuredRewards, stats.allTimeXp);
  }

  public async syncGuild(
    guild: Guild,
    onProgress?: (progress: GuildRoleSyncProgress) => Promise<void> | void,
  ): Promise<GuildRoleSyncResult> {
    const configuredRewards = await this.rewards.listRewards(guild.id);
    const emptyResult = createEmptyGuildResult(configuredRewards.length);

    if (configuredRewards.length === 0) {
      return emptyResult;
    }

    const configurationIssues = await this.validateGuildConfiguration(
      guild,
      configuredRewards,
    );

    if (configurationIssues.length > 0) {
      return {
        ...emptyResult,
        status: "blocked",
        issues: configurationIssues,
      };
    }

    const [members, xpMembers] = await Promise.all([
      guild.members.fetch(),
      this.memberXp.listGuildMemberXp(guild.id),
    ]);
    const reportedIssues: RoleSyncIssue[] = [];
    const result: GuildRoleSyncResult = {
      ...emptyResult,
      totalXpMemberCount: xpMembers.length,
      issues: reportedIssues,
    };
    let nextMemberIndex = 0;

    const reportProgress = async (): Promise<void> => {
      await onProgress?.({
        totalXpMemberCount: result.totalXpMemberCount,
        processedXpMemberCount: result.processedXpMemberCount,
        updatedMemberCount: result.updatedMemberCount,
        grantedRoleCount: result.grantedRoleCount,
        failedMemberCount: result.failedMemberCount,
      });
    };
    const worker = async (): Promise<void> => {
      while (nextMemberIndex < xpMembers.length) {
        const xpMember = xpMembers[nextMemberIndex];
        nextMemberIndex += 1;

        if (!xpMember) {
          continue;
        }

        const member = members.get(xpMember.userId);

        if (!member) {
          result.departedMemberCount += 1;
        } else if (member.user.bot) {
          result.botMemberCount += 1;
        } else {
          const memberResult = await this.syncMemberWithXp(
            member,
            configuredRewards,
            xpMember.allTimeXp,
          );

          if (memberResult.issues.length > 0) {
            result.failedMemberCount += 1;
            const remainingIssueSlots =
              MAX_REPORTED_BULK_ISSUES - reportedIssues.length;

            if (remainingIssueSlots > 0) {
              reportedIssues.push(
                ...memberResult.issues.slice(0, remainingIssueSlots),
              );
            }
          } else if (memberResult.addedRoleIds.length > 0) {
            result.updatedMemberCount += 1;
            result.grantedRoleCount += memberResult.addedRoleIds.length;
          } else if (memberResult.earnedRoleIds.length === 0) {
            result.belowFirstRewardMemberCount += 1;
          } else {
            result.alreadyCurrentMemberCount += 1;
          }
        }

        result.processedXpMemberCount += 1;

        if (
          result.processedXpMemberCount % 25 === 0 ||
          result.processedXpMemberCount === result.totalXpMemberCount
        ) {
          await reportProgress();
        }
      }
    };
    const workerCount = Math.min(BULK_SYNC_WORKER_COUNT, xpMembers.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => worker()),
    );

    return result;
  }
}
