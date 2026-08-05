export interface XpRoleReward {
  guildId: string;
  roleId: string;
  requiredLevel: number;
}

/** Phase 6 will implement stacked role grants and hierarchy error reporting. */
export interface RoleRewardService {
  grantEarnedRoles(input: {
    guildId: string;
    userId: string;
    level: number;
  }): Promise<void>;
}
