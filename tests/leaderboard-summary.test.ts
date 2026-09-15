import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLeaderboardSummaryResponse,
  leaderboardSummaryCommand,
  loadLeaderboardSummaryPages,
} from "../src/commands/leaderboard-summary.js";
import type {
  LeaderboardPage,
  LeaderboardService,
} from "../src/services/leaderboards/leaderboard-service.js";

function page(
  scope: "daily" | "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
): LeaderboardPage {
  return {
    kind: "current",
    scope,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    participantCount: 4,
    visibleEntryCount: 4,
    entries: [
      {
        rank: 1,
        userId: "111111111111111111",
        xp: 5_073,
        allTimeXp: 1_593_932,
        recordStart: null,
        recordEnd: null,
      },
      {
        rank: 2,
        userId: "222222222222222222",
        xp: 950,
        allTimeXp: 5_000,
        recordStart: null,
        recordEnd: null,
      },
      {
        rank: 3,
        userId: "333333333333333333",
        xp: 400,
        allTimeXp: 20_000,
        recordStart: null,
        recordEnd: null,
      },
      {
        rank: 4,
        userId: "444444444444444444",
        xp: 100,
        allTimeXp: 10_000,
        recordStart: null,
        recordEnd: null,
      },
    ],
    timezone: "Europe/Berlin",
    periodStart,
    periodEnd,
    launchLimited: false,
    generatedAt: new Date("2026-09-15T12:00:00.000Z"),
  };
}

describe("leaderboard summary", () => {
  it("renders the current daily, weekly, and monthly top three in one embed", () => {
    const response = buildLeaderboardSummaryResponse({
      daily: page("daily", "2026-09-15", "2026-09-15"),
      weekly: page("weekly", "2026-09-14", "2026-09-20"),
      monthly: page("monthly", "2026-09-01", "2026-09-30"),
    });
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Leaderboard Snapshot");
    assert.deepEqual(
      json.fields?.map((field) => field.name),
      [
        "Daily • 15 Sept 2026",
        "Weekly • 14–20 Sept 2026",
        "Monthly • 1–30 Sept 2026",
      ],
    );
    for (const field of json.fields ?? []) {
      assert.match(field.value, /🥇 <@111111111111111111>/);
      assert.match(field.value, /🥈 <@222222222222222222>/);
      assert.match(field.value, /🥉 <@333333333333333333>/);
      assert.doesNotMatch(field.value, /444444444444444444/);
      assert.match(field.value, /LVL/);
      assert.match(field.value, /5,073 XP/);
    }
    assert.deepEqual(response.allowedMentions, { parse: [] });
    assert.equal(response.files, undefined);
    assert.equal(response.components, undefined);
  });

  it("loads all three periods with the same instant and first page", async () => {
    const calls: Parameters<LeaderboardService["getPage"]>[0][] = [];
    const service = {
      getPage: async (input: Parameters<LeaderboardService["getPage"]>[0]) => {
        calls.push(input);
        return page(
          input.scope as "daily" | "weekly" | "monthly",
          "2026-09-15",
          "2026-09-15",
        );
      },
    } as unknown as LeaderboardService;
    const now = new Date("2026-09-15T12:00:00.000Z");

    await loadLeaderboardSummaryPages(
      service,
      "939811280657719327",
      now,
    );

    assert.deepEqual(
      calls.map((call) => call.scope),
      ["daily", "weekly", "monthly"],
    );
    assert.ok(calls.every((call) => call.page === 1));
    assert.ok(calls.every((call) => call.now === now));
  });

  it("registers /lbs as a standalone command without options", () => {
    const json = leaderboardSummaryCommand.data.toJSON();

    assert.equal(json.name, "lbs");
    assert.deepEqual(json.options, []);
  });
});
