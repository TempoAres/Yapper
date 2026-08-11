import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "discord.js";

import { commands } from "../src/commands/index.js";
import { createProgressEmbed } from "../src/commands/progress.js";

const user = {
  username: "Tempo",
  globalName: "Tempo",
  displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
} as User;

const stats = {
  guildId: "939811280657719327",
  userId: "939644859092992060",
  legacyXpRaw: 5_000,
  legacyXpAdjusted: 5_000,
  newBotXp: 250,
  allTimeXp: 5_250,
  rank: 1,
};

describe("member progress presentation", () => {
  it("shows one total without exposing legacy or split XP fields", () => {
    const json = createProgressEmbed(user, stats, false).toJSON();
    const fieldNames = json.fields?.map((field) => field.name) ?? [];

    assert.ok(fieldNames.includes("Total XP"));
    assert.ok(!fieldNames.includes("Legacy baseline"));
    assert.ok(!fieldNames.includes("Yapper XP"));
    assert.doesNotMatch(json.footer?.text ?? "", /legacy/i);
    assert.equal(json.fields?.length, 4);
  });

  it("keeps the curve explanation in /xp info", () => {
    const json = createProgressEmbed(user, stats, true).toJSON();
    const curve = json.fields?.find((field) => field.name === "Level curve");

    assert.match(curve?.value ?? "", /level²/);
  });

  it("registers /rank but no duplicate /level command", () => {
    const names = commands.map((command) => command.data.name);

    assert.ok(names.includes("rank"));
    assert.ok(!names.includes("level"));
  });
});
