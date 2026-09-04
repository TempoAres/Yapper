import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateLeaderboardPeriod,
  calculateLeaderboardResetSchedule,
  localMidnightDaysFrom,
  nextLocalMidnight,
} from "../src/services/leaderboards/leaderboard-period.js";

describe("calculateLeaderboardPeriod", () => {
  it("does not apply date boundaries to the all-time board", () => {
    assert.deepEqual(
      calculateLeaderboardPeriod({
        scope: "all",
        now: new Date("2026-08-05T14:00:00.000Z"),
        timezone: "Europe/Berlin",
        launchedAt: new Date("2026-08-05T12:00:00.000Z"),
      }),
      {
        startDate: null,
        endDate: null,
        displayStartDate: null,
        displayEndDate: null,
        nextResetAt: null,
        launchLimited: false,
      },
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
      {
        startDate: "2026-08-03",
        endDate: "2026-08-05",
        displayStartDate: "2026-08-03",
        displayEndDate: "2026-08-09",
        nextResetAt: new Date("2026-08-09T22:00:00.000Z"),
        launchLimited: false,
      },
    );
  });

  it("uses the current Berlin calendar day for the daily board", () => {
    assert.deepEqual(
      calculateLeaderboardPeriod({
        scope: "daily",
        now: new Date("2026-08-12T21:59:59.000Z"),
        timezone: "Europe/Berlin",
        launchedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      {
        startDate: "2026-08-12",
        endDate: "2026-08-12",
        displayStartDate: "2026-08-12",
        displayEndDate: "2026-08-12",
        nextResetAt: new Date("2026-08-12T22:00:00.000Z"),
        launchLimited: false,
      },
    );

    assert.equal(
      calculateLeaderboardPeriod({
        scope: "daily",
        now: new Date("2026-08-12T22:00:00.000Z"),
        timezone: "Europe/Berlin",
        launchedAt: new Date("2026-01-01T00:00:00.000Z"),
      }).startDate,
      "2026-08-13",
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
      {
        startDate: "2026-08-05",
        endDate: "2026-08-05",
        displayStartDate: "2026-08-03",
        displayEndDate: "2026-08-09",
        nextResetAt: new Date("2026-08-09T22:00:00.000Z"),
        launchLimited: true,
      },
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

  it("calculates the complete displayed periods", () => {
    const common = {
      now: new Date("2026-08-12T07:22:00.000Z"),
      timezone: "Europe/Berlin",
      launchedAt: new Date("2026-08-05T12:00:00.000Z"),
    };
    const weekly = calculateLeaderboardPeriod({
      ...common,
      scope: "weekly",
    });
    const monthly = calculateLeaderboardPeriod({
      ...common,
      scope: "monthly",
    });
    const yearly = calculateLeaderboardPeriod({
      ...common,
      scope: "yearly",
    });

    assert.deepEqual(
      [weekly.displayStartDate, weekly.displayEndDate],
      ["2026-08-10", "2026-08-16"],
    );
    assert.deepEqual(
      [monthly.displayStartDate, monthly.displayEndDate],
      ["2026-08-01", "2026-08-31"],
    );
    assert.deepEqual(
      [yearly.displayStartDate, yearly.displayEndDate],
      ["2026-01-01", "2026-12-31"],
    );
    assert.equal(monthly.startDate, "2026-08-05");
    assert.equal(yearly.startDate, "2026-08-05");
    assert.equal(weekly.endDate, "2026-08-12");
  });

  it("calculates Berlin reset instants including daylight-saving offsets", () => {
    const schedule = calculateLeaderboardResetSchedule({
      now: new Date("2026-08-12T07:22:00.000Z"),
      timezone: "Europe/Berlin",
    });

    assert.equal(schedule.daily.toISOString(), "2026-08-12T22:00:00.000Z");
    assert.equal(schedule.weekly.toISOString(), "2026-08-16T22:00:00.000Z");
    assert.equal(schedule.monthly.toISOString(), "2026-08-31T22:00:00.000Z");
    assert.equal(schedule.yearly.toISOString(), "2026-12-31T23:00:00.000Z");

    const afterDstChange = calculateLeaderboardResetSchedule({
      now: new Date("2026-10-24T12:00:00.000Z"),
      timezone: "Europe/Berlin",
    });
    assert.equal(
      afterDstChange.weekly.toISOString(),
      "2026-10-25T23:00:00.000Z",
    );
  });
});

describe("nextLocalMidnight", () => {
  it("returns the next Europe/Berlin midnight", () => {
    assert.equal(
      nextLocalMidnight(
        new Date("2026-09-03T18:30:00.000Z"),
        "Europe/Berlin",
      ).toISOString(),
      "2026-09-03T22:00:00.000Z",
    );
  });

  it("keeps local midnight across daylight-saving transitions", () => {
    assert.equal(
      nextLocalMidnight(
        new Date("2026-03-28T12:00:00.000Z"),
        "Europe/Berlin",
      ).toISOString(),
      "2026-03-28T23:00:00.000Z",
    );
    assert.equal(
      nextLocalMidnight(
        new Date("2026-10-24T12:00:00.000Z"),
        "Europe/Berlin",
      ).toISOString(),
      "2026-10-24T22:00:00.000Z",
    );
  });
});

describe("localMidnightDaysFrom", () => {
  it("finds the prior Monday across a daylight-saving week", () => {
    assert.equal(
      localMidnightDaysFrom(
        new Date("2026-10-25T23:00:00.000Z"),
        "Europe/Berlin",
        -7,
      ).toISOString(),
      "2026-10-18T22:00:00.000Z",
    );
  });
});
