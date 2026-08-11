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
  it("uses colored role mentions while explicitly suppressing pings", async () => {
    const roles = new Map([
      ["100000000000000001", { id: "100000000000000001", name: "Yapper One" }],
      ["100000000000000005", { id: "100000000000000005", name: "Yapper Five" }],
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
          {
            guildId: "guild-1",
            roleId: "100000000000000001",
            requiredLevel: 1,
          },
          {
            guildId: "guild-1",
            roleId: "100000000000000005",
            requiredLevel: 5,
          },
        ];
      },
    };

    const response = await buildRewardsResponse(guild, service);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const description = embed.toJSON().description ?? "";
    assert.equal(embed.toJSON().title, "Rewards");
    assert.match(description, /\*\*1\.\*\* <@&100000000000000001>/);
    assert.match(description, /\[lvl5\]/);
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
