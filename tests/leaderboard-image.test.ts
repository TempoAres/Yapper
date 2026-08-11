import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import {
  leaderboardImageDimensions,
  renderLeaderboardImage,
  type LeaderboardMemberProfile,
} from "../src/services/leaderboards/leaderboard-image.js";

describe("leaderboard image renderer", () => {
  it("creates a compact PNG with exactly one row per member", async () => {
    const avatar = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#5865F2",
      },
    })
      .png()
      .toBuffer();
    const profiles = new Map<string, LeaderboardMemberProfile>([
      [
        "user-1",
        {
          userId: "user-1",
          displayName: "tempoares",
          avatarDataUri: `data:image/png;base64,${avatar.toString("base64")}`,
        },
      ],
      [
        "user-2",
        {
          userId: "user-2",
          displayName: "an_extremely_long_<unsafe>&_username",
          avatarDataUri: null,
        },
      ],
    ]);
    const image = await renderLeaderboardImage({
      rows: [
        { rank: 1, userId: "user-1", detail: "LVL: 163", progress: 0.8 },
        { rank: 2, userId: "user-2", detail: "XP: +1,784" },
      ],
      profiles,
      emptyMessage: "No activity yet.",
    });
    const metadata = await sharp(image).metadata();

    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, leaderboardImageDimensions.width);
    assert.equal(leaderboardImageDimensions.fontSize, 32);
    assert.equal(leaderboardImageDimensions.minimumFontSize, 27);
    assert.equal(
      metadata.height,
      leaderboardImageDimensions.rowHeight * 2 +
        leaderboardImageDimensions.rowGap,
    );
  });

  it("renders a useful empty state instead of a blank attachment", async () => {
    const image = await renderLeaderboardImage({
      rows: [],
      profiles: new Map(),
      emptyMessage: "No eligible reactions have been recorded yet.",
    });
    const metadata = await sharp(image).metadata();

    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, leaderboardImageDimensions.width);
    assert.equal(metadata.height, 104);
  });
});
