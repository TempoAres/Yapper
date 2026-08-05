import type { LeaderboardScope } from "./leaderboard-service.js";

export interface LeaderboardPeriod {
  startDate: string | null;
  endDate: string | null;
  launchLimited: boolean;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function getLocalDateParts(date: Date, timezone: string): LocalDateParts {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Leaderboard dates must be valid Date values.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const valueFor = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);

    if (!Number.isInteger(value)) {
      throw new Error(`Could not calculate the ${type} in ${timezone}.`);
    }

    return value;
  };

  return {
    year: valueFor("year"),
    month: valueFor("month"),
    day: valueFor("day"),
  };
}

function toIsoDate(parts: LocalDateParts): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function startOfWeek(parts: LocalDateParts): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function calculateLeaderboardPeriod(input: {
  scope: LeaderboardScope;
  now: Date;
  timezone: string;
  launchedAt: Date;
}): LeaderboardPeriod {
  if (input.scope === "all") {
    return { startDate: null, endDate: null, launchLimited: false };
  }

  const today = getLocalDateParts(input.now, input.timezone);
  const naturalStart =
    input.scope === "weekly"
      ? startOfWeek(today)
      : {
          year: today.year,
          month: input.scope === "monthly" ? today.month : 1,
          day: 1,
        };
  const naturalStartDate = toIsoDate(naturalStart);
  const endDate = toIsoDate(today);
  const launchDate = toIsoDate(
    getLocalDateParts(input.launchedAt, input.timezone),
  );
  const launchLimited = launchDate > naturalStartDate;

  return {
    startDate: launchLimited ? launchDate : naturalStartDate,
    endDate,
    launchLimited,
  };
}
