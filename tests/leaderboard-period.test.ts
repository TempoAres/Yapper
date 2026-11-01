import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateLeaderboardPeriod,
  calculateLeaderboardResetSchedule,
  calculatePreviousLeaderboardPeriod,
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

describe("calculatePreviousLeaderboardPeriod", () => {
  const common = {
    timezone: "Europe/Berlin",
    launchedAt: new Date("2020-01-01T00:00:00.000Z"),
  };

  it("selects the completed day, Monday-based week, month, and year", () => {
    for (const [scope, start, end] of [
      ["daily", "2026-08-04", "2026-08-04"],
      ["weekly", "2026-07-27", "2026-08-02"],
      ["monthly", "2026-07-01", "2026-07-31"],
      ["yearly", "2025-01-01", "2025-12-31"],
    ] as const) {
      const period = calculatePreviousLeaderboardPeriod({
        ...common,
        scope,
        now: new Date("2026-08-05T14:00:00.000Z"),
      });
      assert.deepEqual(
        [period.startDate, period.endDate, period.displayStartDate, period.displayEndDate],
        [start, end, start, end],
      );
      assert.equal(period.launchLimited, false);
    }
  });

  it("switches months at local midnight, including the winter offset", () => {
    const before = calculatePreviousLeaderboardPeriod({
      ...common,
      scope: "monthly",
      now: new Date("2026-10-31T22:59:59.999Z"),
    });
    const after = calculatePreviousLeaderboardPeriod({
      ...common,
      scope: "monthly",
      now: new Date("2026-10-31T23:00:00.000Z"),
    });
    assert.equal(before.endDate, "2026-09-30");
    assert.equal(after.startDate, "2026-10-01");
    assert.equal(after.endDate, "2026-10-31");
    assert.equal(after.nextResetAt?.toISOString(), "2026-10-31T23:00:00.000Z");
  });

  it("handles leap February and the January year boundary", () => {
    const leap = calculatePreviousLeaderboardPeriod({
      ...common,
      scope: "monthly",
      now: new Date("2024-03-01T00:00:00.000Z"),
    });
    assert.equal(leap.startDate, "2024-02-01");
    assert.equal(leap.endDate, "2024-02-29");
    const january = calculatePreviousLeaderboardPeriod({
      ...common,
      scope: "monthly",
      now: new Date("2026-12-31T23:00:00.000Z"),
    });
    assert.equal(january.startDate, "2026-12-01");
    assert.equal(january.endDate, "2026-12-31");
    const year = calculatePreviousLeaderboardPeriod({
      ...common,
      scope: "yearly",
      now: new Date("2026-12-31T23:00:00.000Z"),
    });
    assert.equal(year.startDate, "2026-01-01");
    assert.equal(year.endDate, "2026-12-31");
  });

  it("uses calendar days across the spring and autumn clock changes", () => {
    for (const [now, start, end] of [
      ["2026-03-29T22:00:00.000Z", "2026-03-23", "2026-03-29"],
      ["2026-10-25T23:00:00.000Z", "2026-10-19", "2026-10-25"],
    ]) {
      const period = calculatePreviousLeaderboardPeriod({
        ...common,
        scope: "weekly",
        now: new Date(now!),
      });
      assert.equal(period.startDate, start);
      assert.equal(period.endDate, end);
    }
  });

  it("clips the launch month and leaves pre-launch periods empty", () => {
    const input = {
      ...common,
      scope: "monthly" as const,
      launchedAt: new Date("2026-08-05T12:00:00.000Z"),
    };
    const firstMonth = calculatePreviousLeaderboardPeriod({
      ...input,
      now: new Date("2026-09-15T12:00:00.000Z"),
    });
    assert.equal(firstMonth.startDate, "2026-08-05");
    assert.equal(firstMonth.displayStartDate, "2026-08-01");
    assert.equal(firstMonth.endDate, "2026-08-31");
    assert.equal(firstMonth.launchLimited, true);
    const beforeLaunch = calculatePreviousLeaderboardPeriod({
      ...input,
      now: new Date("2026-08-15T12:00:00.000Z"),
    });
    assert.ok(beforeLaunch.startDate! > beforeLaunch.endDate!);
    assert.equal(beforeLaunch.endDate, "2026-07-31");
  });

  it("keeps an open leaderboard on its selected month after another reset", () => {
    const period = calculatePreviousLeaderboardPeriod({
      ...common,
      scope: "monthly",
      now: new Date("2027-01-15T12:00:00.000Z"),
      periodEnd: "2026-08-31",
    });
    assert.equal(period.startDate, "2026-08-01");
    assert.equal(period.endDate, "2026-08-31");
  });

  it("rejects invalid dates, partial periods, and periods that are still active", () => {
    for (const periodEnd of ["invalid", "2026-02-30", "2026-07-30", "2026-08-31"]) {
      assert.throws(() => calculatePreviousLeaderboardPeriod({
        ...common,
        scope: "monthly",
        now: new Date("2026-08-15T12:00:00.000Z"),
        periodEnd,
      }), RangeError);
    }
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
