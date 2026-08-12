import type {
  LeaderboardResetSchedule,
  LeaderboardScope,
} from "./leaderboard-service.js";

export interface LeaderboardPeriod {
  startDate: string | null;
  endDate: string | null;
  displayStartDate: string | null;
  displayEndDate: string | null;
  nextResetAt: Date | null;
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

function addDays(parts: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function endOfMonth(parts: LocalDateParts): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month, 0));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getTimezoneOffsetMilliseconds(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);

    if (!Number.isInteger(value)) {
      throw new Error(`Could not calculate the ${type} in ${timezone}.`);
    }

    return value;
  };
  const representedAsUtc = Date.UTC(
    valueFor("year"),
    valueFor("month") - 1,
    valueFor("day"),
    valueFor("hour"),
    valueFor("minute"),
    valueFor("second"),
  );
  const wholeSecondInstant = Math.floor(date.getTime() / 1_000) * 1_000;

  return representedAsUtc - wholeSecondInstant;
}

function localMidnight(parts: LocalDateParts, timezone: string): Date {
  const localTimeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let instant = localTimeAsUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const adjusted =
      localTimeAsUtc -
      getTimezoneOffsetMilliseconds(new Date(instant), timezone);

    if (adjusted === instant) {
      break;
    }

    instant = adjusted;
  }

  const result = new Date(instant);
  const localDate = getLocalDateParts(result, timezone);

  if (toIsoDate(localDate) !== toIsoDate(parts)) {
    throw new Error(`Could not resolve local midnight in ${timezone}.`);
  }

  return result;
}

function naturalPeriod(scope: Exclude<LeaderboardScope, "all">, today: LocalDateParts): {
  start: LocalDateParts;
  end: LocalDateParts;
} {
  if (scope === "weekly") {
    const start = startOfWeek(today);
    return { start, end: addDays(start, 6) };
  }

  if (scope === "monthly") {
    const start = { year: today.year, month: today.month, day: 1 };
    return { start, end: endOfMonth(start) };
  }

  return {
    start: { year: today.year, month: 1, day: 1 },
    end: { year: today.year, month: 12, day: 31 },
  };
}

export function calculateLeaderboardResetSchedule(input: {
  now: Date;
  timezone: string;
}): LeaderboardResetSchedule {
  const today = getLocalDateParts(input.now, input.timezone);
  const resetFor = (scope: Exclude<LeaderboardScope, "all">): Date =>
    localMidnight(addDays(naturalPeriod(scope, today).end, 1), input.timezone);

  return {
    timezone: input.timezone,
    weekly: resetFor("weekly"),
    monthly: resetFor("monthly"),
    yearly: resetFor("yearly"),
  };
}

export function calculateLeaderboardPeriod(input: {
  scope: LeaderboardScope;
  now: Date;
  timezone: string;
  launchedAt: Date;
}): LeaderboardPeriod {
  if (input.scope === "all") {
    return {
      startDate: null,
      endDate: null,
      displayStartDate: null,
      displayEndDate: null,
      nextResetAt: null,
      launchLimited: false,
    };
  }

  const today = getLocalDateParts(input.now, input.timezone);
  const period = naturalPeriod(input.scope, today);
  const naturalStartDate = toIsoDate(period.start);
  const endDate = toIsoDate(today);
  const launchDate = toIsoDate(
    getLocalDateParts(input.launchedAt, input.timezone),
  );
  const launchLimited = launchDate > naturalStartDate;

  return {
    startDate: launchLimited ? launchDate : naturalStartDate,
    endDate,
    displayStartDate: naturalStartDate,
    displayEndDate: toIsoDate(period.end),
    nextResetAt: localMidnight(addDays(period.end, 1), input.timezone),
    launchLimited,
  };
}
