import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";

import {
  buildLeaderboardResponse,
  leaderboardCommand,
  parseLeaderboardButton,
  topCommand,
} from "../src/commands/leaderboard.js";
import type { LeaderboardPage } from "../src/services/leaderboards/leaderboard-service.js";

const requesterId = "939644859092992060";

function examplePage(overrides: Partial<LeaderboardPage> = {}): LeaderboardPage {
  return {
    kind: "current",
    scope: "weekly",
    page: 1,
    pageSize: 10,
    totalPages: 2,
    participantCount: 12,
    visibleEntryCount: 12,
    entries: [
      {
        rank: 1,
        userId: requesterId,
        xp: 5_073,
        allTimeXp: 1_593_932,
        recordStart: null,
        recordEnd: null,
      },
      {
        rank: 2,
        userId: "153452985728578777",
        xp: 950,
        allTimeXp: 5_000,
        recordStart: null,
        recordEnd: null,
      },
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
  it("renders levels and progress without exposing XP by default", () => {
    const response = buildLeaderboardResponse(examplePage(), requesterId);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Weekly level leaderboard");
    assert.match(json.description ?? "", /tracking started/);
    assert.match(json.fields?.[0]?.value ?? "", /Level \*\*177\*\*/);
    assert.doesNotMatch(json.fields?.[0]?.value ?? "", /5,073 XP/);
  });

  it("renders exact XP only for the XP view", () => {
    const response = buildLeaderboardResponse(examplePage(), requesterId, "xp");
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Weekly XP leaderboard");
    assert.match(json.fields?.[0]?.value ?? "", /5,073 XP/);
  });

  it("renders historical record dates", () => {
    const response = buildLeaderboardResponse(
      examplePage({
        kind: "record",
        periodStart: null,
        periodEnd: null,
        launchLimited: false,
        entries: [
          {
            rank: 1,
            userId: requesterId,
            xp: 8_500,
            allTimeXp: 1_593_932,
            recordStart: "2026-08-03",
            recordEnd: "2026-08-09",
          },
        ],
      }),
      requesterId,
      "record",
    );
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Weekly activity records");
    assert.match(json.fields?.[0]?.value ?? "", /8,500 XP/);
    assert.match(json.fields?.[0]?.value ?? "", /3 Aug 2026/);
  });

  it("creates requester-bound first, previous, next, and last buttons", () => {
    const response = buildLeaderboardResponse(examplePage(), requesterId, "level");
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
      `yapper:lb:next:level:weekly:2:${requesterId}`,
    );
    assert.equal(buttons[2]?.disabled, false);
  });

  it("accepts only valid Top 100 navigation IDs", () => {
    assert.deepEqual(
      parseLeaderboardButton(
        `yapper:leaderboard:last:monthly:10:${requesterId}`,
      ),
      { action: "last", view: "xp", scope: "monthly", page: 10, requesterId },
    );
    assert.equal(
      parseLeaderboardButton(
        `yapper:leaderboard:last:monthly:11:${requesterId}`,
      ),
      null,
    );
    assert.equal(parseLeaderboardButton("some-other-button"), null);
  });

  it("publishes the requested short command hierarchy", () => {
    const leaderboard = leaderboardCommand.data.toJSON();
    const top = topCommand.data.toJSON();

    assert.equal(leaderboard.name, "lb");
    assert.deepEqual(
      leaderboard.options?.map((option) => option.name),
      ["all", "weekly", "monthly", "yearly", "xp"],
    );
    const xpGroup = leaderboard.options?.find((option) => option.name === "xp");
    assert.ok(xpGroup && "options" in xpGroup);
    assert.deepEqual(
      xpGroup.options?.map((option) => option.name),
      ["all", "weekly", "monthly", "yearly"],
    );
    assert.equal(top.name, "top");
    assert.deepEqual(
      top.options?.map((option) => option.name),
      ["weekly", "monthly", "yearly"],
    );
  });
});
