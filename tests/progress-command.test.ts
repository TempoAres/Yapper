import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "discord.js";
import sharp from "sharp";

import { commands } from "../src/commands/index.js";
import {
  buildRankResponse,
  createProgressEmbed,
} from "../src/commands/progress.js";
import {
  rankImageDimensions,
  renderRankImage,
} from "../src/services/leaderboards/rank-image.js";

const user = {
  id: "939644859092992060",
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
  it("renders /rank as a compact leaderboard-style image", async () => {
    const profile = {
      userId: user.id,
      displayName: "Tempo",
      avatarDataUri: null,
    };
    const image = await renderRankImage({
      profile,
      rank: 1,
      level: 7,
      totalXp: 5_250,
      xpInCurrentLevel: 259,
      xpForNextLevel: 1_100,
      xpNeededForNextLevel: 841,
      progress: 259 / 1_100,
    });
    const metadata = await sharp(image).metadata();
    const response = await buildRankResponse(user, stats, profile);
    const embed = response.embeds?.[0];

    assert.equal(metadata.width, rankImageDimensions.width);
    assert.equal(metadata.height, rankImageDimensions.height);
    assert.ok(embed && "toJSON" in embed);
    assert.equal(embed.toJSON().title, "Yapper Rank");
    assert.equal(embed.toJSON().fields, undefined);
    assert.match(embed.toJSON().image?.url ?? "", /^attachment:\/\//);
    assert.equal(response.files?.length, 1);
  });

  it("keeps the curve explanation in /xp info", () => {
    const json = createProgressEmbed(user, stats, true).toJSON();
    const curve = json.fields?.find((field) => field.name === "Level curve");

    assert.match(curve?.value ?? "", /level²/);
    assert.ok(json.fields?.some((field) => field.name === "Total XP"));
    assert.ok(!json.fields?.some((field) => field.name === "Legacy baseline"));
  });

  it("registers /rank but no duplicate /level command", () => {
    const names = commands.map((command) => command.data.name);

    assert.ok(names.includes("rank"));
    assert.ok(!names.includes("level"));
  });
});
