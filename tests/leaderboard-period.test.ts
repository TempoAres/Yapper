import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateLeaderboardPeriod } from "../src/services/leaderboards/leaderboard-period.js";

describe("calculateLeaderboardPeriod", () => {
  it("does not apply date boundaries to the all-time board", () => {
    assert.deepEqual(
      calculateLeaderboardPeriod({
        scope: "all",
        now: new Date("2026-08-05T14:00:00.000Z"),
        timezone: "Europe/Berlin",
        launchedAt: new Date("2026-08-05T12:00:00.000Z"),
      }),
      { startDate: null, endDate: null, launchLimited: false },
    );
  });

  it("starts a normal Berlin week on Monday", () => {
    assert.deepEqual(
      calculateLeaderboardPeriod({
        scope: "weekly",
        now: new Date("2026-08-05T14:00:00.000Z"),
        timezone: "Europe/Berlin",
        launchedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      { startDate: "2026-08-03", endDate: "2026-08-05", launchLimited: false },
    );
  });

  it("clips the first period to Yapper's local launch date", () => {
    assert.deepEqual(
      calculateLeaderboardPeriod({
        scope: "weekly",
        now: new Date("2026-08-05T14:00:00.000Z"),
        timezone: "Europe/Berlin",
        launchedAt: new Date("2026-08-05T12:00:00.000Z"),
      }),
      { startDate: "2026-08-05", endDate: "2026-08-05", launchLimited: true },
    );
  });

  it("uses Berlin midnight for the Monday rollover", () => {
    const beforeMidnight = calculateLeaderboardPeriod({
      scope: "weekly",
      now: new Date("2026-08-09T21:59:59.000Z"),
      timezone: "Europe/Berlin",
      launchedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const afterMidnight = calculateLeaderboardPeriod({
      scope: "weekly",
      now: new Date("2026-08-09T22:00:00.000Z"),
      timezone: "Europe/Berlin",
      launchedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(beforeMidnight.startDate, "2026-08-03");
    assert.equal(beforeMidnight.endDate, "2026-08-09");
    assert.equal(afterMidnight.startDate, "2026-08-10");
    assert.equal(afterMidnight.endDate, "2026-08-10");
  });

  it("calculates monthly and yearly calendar starts", () => {
    const common = {
      now: new Date("2026-08-05T14:00:00.000Z"),
      timezone: "Europe/Berlin",
      launchedAt: new Date("2025-01-01T00:00:00.000Z"),
    };

    assert.equal(
      calculateLeaderboardPeriod({ ...common, scope: "monthly" }).startDate,
      "2026-08-01",
    );
    assert.equal(
      calculateLeaderboardPeriod({ ...common, scope: "yearly" }).startDate,
      "2026-01-01",
    );
  });
});
