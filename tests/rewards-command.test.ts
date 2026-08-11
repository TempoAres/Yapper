import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Guild } from "discord.js";

import {
  buildRewardsResponse,
  rewardsCommand,
} from "../src/commands/rewards.js";
import { xpCommand } from "../src/commands/xp.js";
import type { RoleRewardService } from "../src/services/roles/role-reward-service.js";

describe("rewards command", () => {
  it("lists levels and role names without creating role mentions", async () => {
    const roles = new Map([
      ["role-1", { id: "role-1", name: "Yapper One" }],
      ["role-5", { id: "role-5", name: "Yapper Five" }],
    ]);
    const guild = {
      id: "guild-1",
      roles: { fetch: async () => roles },
    } as unknown as Guild;
    const service: RoleRewardService = {
      async addReward() {
        throw new Error("Not used.");
      },
      async removeReward() {
        throw new Error("Not used.");
      },
      async listRewards() {
        return [
          { guildId: "guild-1", roleId: "role-1", requiredLevel: 1 },
          { guildId: "guild-1", roleId: "role-5", requiredLevel: 5 },
        ];
      },
    };

    const response = await buildRewardsResponse(guild, service);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const description = embed.toJSON().description ?? "";
    assert.match(description, /Level 1/);
    assert.match(description, /@Yapper One/);
    assert.doesNotMatch(description, /<@&/);
    assert.deepEqual(response.allowedMentions, { parse: [] });
  });

  it("registers the short public /rewards command", () => {
    assert.equal(rewardsCommand.data.toJSON().name, "rewards");
    const xp = xpCommand.data.toJSON();
    const roles = xp.options?.find((option) => option.name === "roles");

    assert.ok(roles && "options" in roles);
    assert.ok(roles.options?.some((option) => option.name === "sync-all"));
  });
});
