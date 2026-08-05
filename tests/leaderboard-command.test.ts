import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";

import {
  buildLeaderboardResponse,
  parseLeaderboardButton,
} from "../src/commands/leaderboard.js";
import type { LeaderboardPage } from "../src/services/leaderboards/leaderboard-service.js";

const requesterId = "939644859092992060";

function examplePage(overrides: Partial<LeaderboardPage> = {}): LeaderboardPage {
  return {
    scope: "weekly",
    page: 1,
    pageSize: 10,
    totalPages: 2,
    participantCount: 12,
    visibleEntryCount: 12,
    entries: [
      { rank: 1, userId: requesterId, xp: 5_073 },
      { rank: 2, userId: "153452985728578777", xp: 950 },
    ],
    timezone: "Europe/Berlin",
    periodStart: "2026-08-05",
    periodEnd: "2026-08-05",
    launchLimited: true,
    generatedAt: new Date("2026-08-05T15:00:00.000Z"),
    ...overrides,
  };
}

describe("leaderboard presentation", () => {
  it("renders ranked XP and the first-period launch note", () => {
    const response = buildLeaderboardResponse(examplePage(), requesterId);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Weekly Yapper leaderboard");
    assert.match(json.description ?? "", /starts at Yapper's launch/);
    assert.match(json.fields?.[0]?.value ?? "", /5,073 XP/);
  });

  it("creates requester-bound first, previous, next, and last buttons", () => {
    const response = buildLeaderboardResponse(examplePage(), requesterId);
    const row = response.components?.[0];

    assert.ok(row && "toJSON" in row);
    const buttons = (row as ActionRowBuilder<ButtonBuilder>).components.map(
      (button) => button.toJSON(),
    );
    assert.equal(buttons.length, 4);
    assert.equal(buttons[0]?.disabled, true);
    const customIds = buttons.flatMap((button) =>
      "custom_id" in button ? [button.custom_id] : [],
    );
    assert.equal(new Set(customIds).size, 4);
    assert.ok(buttons[2] && "custom_id" in buttons[2]);
    assert.equal(
      buttons[2].custom_id,
      `yapper:leaderboard:next:weekly:2:${requesterId}`,
    );
    assert.equal(buttons[2]?.disabled, false);
  });

  it("accepts only valid Top 100 navigation IDs", () => {
    assert.deepEqual(
      parseLeaderboardButton(
        `yapper:leaderboard:last:monthly:10:${requesterId}`,
      ),
      { action: "last", scope: "monthly", page: 10, requesterId },
    );
    assert.equal(
      parseLeaderboardButton(
        `yapper:leaderboard:last:monthly:11:${requesterId}`,
      ),
      null,
    );
    assert.equal(parseLeaderboardButton("some-other-button"), null);
  });
});
