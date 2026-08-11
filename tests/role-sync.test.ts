import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Guild, GuildMember } from "discord.js";

import { DiscordRoleRewardCoordinator } from "../src/bot/role-reward-coordinator.js";
import type {
  RoleRewardService,
  XpRoleReward,
} from "../src/services/roles/role-reward-service.js";
import { planStackedRoleSync } from "../src/services/roles/role-sync.js";
import { totalXpForLevel } from "../src/services/xp/level-curve.js";
import type { MemberXpService } from "../src/services/xp/member-xp-service.js";

interface FakeRole {
  id: string;
  name: string;
  managed: boolean;
  position: number;
}

function reward(roleId: string, requiredLevel: number): XpRoleReward {
  return { guildId: "guild-1", roleId, requiredLevel };
}

function createRewardService(
  rewards: readonly XpRoleReward[],
): RoleRewardService {
  return {
    async addReward() {
      throw new Error("Not used by this test.");
    },
    async removeReward() {
      throw new Error("Not used by this test.");
    },
    async listRewards() {
      return rewards;
    },
  };
}

function createMemberXpService(level: number): MemberXpService {
  const allTimeXp = totalXpForLevel(level);
  return {
    async getMemberStats(guildId, userId) {
      return {
        guildId,
        userId,
        legacyXpRaw: 0,
        legacyXpAdjusted: 0,
        newBotXp: allTimeXp,
        allTimeXp,
        rank: 1,
      };
    },
    async listGuildMemberXp() {
      return [{ userId: "user-1", allTimeXp }];
    },
  };
}

function createFakeMember(input: {
  roles: readonly FakeRole[];
  currentRoleIds?: readonly string[];
  botHasManageRoles?: boolean;
  botHighestPosition?: number;
  assignmentFails?: boolean;
}): { member: GuildMember; additions: string[][] } {
  const roleCache = new Map(input.roles.map((role) => [role.id, role]));
  const currentRoleCache = new Map(
    (input.currentRoleIds ?? []).map((roleId) => [roleId, {}]),
  );
  const additions: string[][] = [];
  const botMember = {
    permissions: {
      has: () => input.botHasManageRoles ?? true,
    },
    roles: {
      highest: { position: input.botHighestPosition ?? 100 },
    },
  };
  const guild = {
    id: "guild-1",
    roles: {
      cache: roleCache,
      fetch: async (roleId: string) => roleCache.get(roleId) ?? null,
    },
    members: {
      me: botMember,
      fetchMe: async () => botMember,
    },
  };
  const member = {
    id: "user-1",
    guild,
    roles: {
      cache: currentRoleCache,
      add: async (roleIds: readonly string[]) => {
        if (input.assignmentFails) {
          throw new Error("simulated Discord failure");
        }

        additions.push([...roleIds]);
      },
    },
  };

  return { member: member as unknown as GuildMember, additions };
}

describe("planStackedRoleSync", () => {
  it("keeps earlier rewards and identifies only missing earned roles", () => {
    const result = planStackedRoleSync({
      rewards: [reward("role-10", 10), reward("role-1", 1), reward("role-5", 5)],
      level: 7,
      currentRoleIds: new Set(["role-1"]),
    });

    assert.deepEqual(result.earned.map((item) => item.roleId), ["role-1", "role-5"]);
    assert.deepEqual(result.existing.map((item) => item.roleId), ["role-1"]);
    assert.deepEqual(result.missing.map((item) => item.roleId), ["role-5"]);
  });
});

describe("DiscordRoleRewardCoordinator", () => {
  it("grants every missing earned role in one stacked catch-up", async () => {
    const rewards = [reward("role-1", 1), reward("role-5", 5), reward("role-8", 8)];
    const { member, additions } = createFakeMember({
      roles: [
        { id: "role-1", name: "Level 1", managed: false, position: 10 },
        { id: "role-5", name: "Level 5", managed: false, position: 20 },
        { id: "role-8", name: "Level 8", managed: false, position: 30 },
      ],
      currentRoleIds: ["role-1"],
    });
    const coordinator = new DiscordRoleRewardCoordinator(
      createRewardService(rewards),
      createMemberXpService(7),
    );

    const result = await coordinator.syncMember(member);

    assert.deepEqual(additions, [["role-5"]]);
    assert.deepEqual(result.existingRoleIds, ["role-1"]);
    assert.deepEqual(result.addedRoleIds, ["role-5"]);
    assert.deepEqual(result.earnedRoleIds, ["role-1", "role-5"]);
    assert.equal(result.issues.length, 0);
  });

  it("reports missing bot permission without attempting an assignment", async () => {
    const { member, additions } = createFakeMember({
      roles: [{ id: "role-1", name: "Level 1", managed: false, position: 10 }],
      botHasManageRoles: false,
    });
    const coordinator = new DiscordRoleRewardCoordinator(
      createRewardService([reward("role-1", 1)]),
      createMemberXpService(1),
    );

    const result = await coordinator.syncMember(member);

    assert.deepEqual(additions, []);
    assert.deepEqual(result.issues.map((issue) => issue.code), [
      "missing_manage_roles",
    ]);
  });

  it("reports missing, managed, and too-high roles individually", async () => {
    const { member, additions } = createFakeMember({
      roles: [
        { id: "managed", name: "Integration", managed: true, position: 10 },
        { id: "too-high", name: "Staff", managed: false, position: 100 },
      ],
      botHighestPosition: 100,
    });
    const coordinator = new DiscordRoleRewardCoordinator(
      createRewardService([
        reward("missing", 1),
        reward("managed", 2),
        reward("too-high", 3),
      ]),
      createMemberXpService(3),
    );

    const result = await coordinator.syncMember(member);

    assert.deepEqual(additions, []);
    assert.deepEqual(
      new Set(result.issues.map((issue) => issue.code)),
      new Set(["role_missing", "managed_role", "role_hierarchy"]),
    );
  });

  it("returns a clear assignment failure without claiming roles were added", async () => {
    const { member } = createFakeMember({
      roles: [{ id: "role-1", name: "Level 1", managed: false, position: 10 }],
      assignmentFails: true,
    });
    const coordinator = new DiscordRoleRewardCoordinator(
      createRewardService([reward("role-1", 1)]),
      createMemberXpService(1),
    );

    const result = await coordinator.syncMember(member);

    assert.deepEqual(result.addedRoleIds, []);
    assert.equal(result.issues[0]?.code, "assignment_failed");
    assert.match(result.issues[0]?.message ?? "", /simulated Discord failure/);
  });

  it("bulk-syncs every current human member with stored XP", async () => {
    const role = {
      id: "role-1",
      name: "Level 1",
      managed: false,
      position: 10,
    };
    const roleCache = new Map([[role.id, role]]);
    const additions = new Map<string, string[][]>();
    const botMember = {
      permissions: { has: () => true },
      roles: { highest: { position: 100 } },
    };
    const guild = {
      id: "guild-1",
      roles: {
        cache: roleCache,
        fetch: async () => roleCache,
      },
      members: {
        me: botMember,
        fetchMe: async () => botMember,
      },
    } as unknown as Guild;
    const createBulkMember = (
      id: string,
      currentRoleIds: readonly string[] = [],
      bot = false,
    ): GuildMember => {
      additions.set(id, []);
      return {
        id,
        user: { bot },
        guild,
        roles: {
          cache: new Map(currentRoleIds.map((roleId) => [roleId, {}])),
          add: async (roleIds: readonly string[]) => {
            additions.get(id)?.push([...roleIds]);
          },
        },
      } as unknown as GuildMember;
    };
    const members = new Map([
      ["user-earned", createBulkMember("user-earned")],
      ["user-low", createBulkMember("user-low")],
      ["user-bot", createBulkMember("user-bot", [], true)],
    ]);
    (guild.members.fetch as unknown as () => Promise<typeof members>) = async () =>
      members;
    const memberXp: MemberXpService = {
      async getMemberStats() {
        throw new Error("Single-member lookup is not used by bulk sync.");
      },
      async listGuildMemberXp() {
        return [
          { userId: "user-earned", allTimeXp: totalXpForLevel(1) },
          { userId: "user-low", allTimeXp: 1 },
          { userId: "user-bot", allTimeXp: totalXpForLevel(1) },
          { userId: "departed", allTimeXp: totalXpForLevel(1) },
        ];
      },
    };
    const coordinator = new DiscordRoleRewardCoordinator(
      createRewardService([reward("role-1", 1)]),
      memberXp,
    );
    const progress: number[] = [];

    const result = await coordinator.syncGuild(guild, (update) => {
      progress.push(update.processedXpMemberCount);
    });

    assert.equal(result.status, "completed");
    assert.equal(result.totalXpMemberCount, 4);
    assert.equal(result.processedXpMemberCount, 4);
    assert.equal(result.updatedMemberCount, 1);
    assert.equal(result.grantedRoleCount, 1);
    assert.equal(result.belowFirstRewardMemberCount, 1);
    assert.equal(result.botMemberCount, 1);
    assert.equal(result.departedMemberCount, 1);
    assert.deepEqual(additions.get("user-earned"), [["role-1"]]);
    assert.deepEqual(progress, [4]);
  });
});
