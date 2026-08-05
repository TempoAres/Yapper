export interface XpRoleReward {
  guildId: string;
  roleId: string;
  requiredLevel: number;
}

export type AddRoleRewardResult =
  | { status: "created"; reward: XpRoleReward }
  | { status: "level_conflict" | "role_conflict"; reward: XpRoleReward };

export interface RoleRewardService {
  addReward(input: XpRoleReward): Promise<AddRoleRewardResult>;
  removeReward(guildId: string, requiredLevel: number): Promise<XpRoleReward | null>;
  listRewards(guildId: string): Promise<readonly XpRoleReward[]>;
}
