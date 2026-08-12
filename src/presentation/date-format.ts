interface CalendarDate {
  day: number;
  month: number;
  year: number;
}

function parseCalendarDate(date: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new Error(`Invalid leaderboard date: ${date}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function monthName(date: CalendarDate): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(date.year, date.month - 1, 1)));
}

function fullDate(date: CalendarDate): string {
  return `${date.day} ${monthName(date)} ${date.year}`;
}

function shortYear(year: number): string {
  return String(year % 100).padStart(2, "0");
}

export function formatCalendarDateRange(start: string, end: string): string {
  const startDate = parseCalendarDate(start);
  const endDate = parseCalendarDate(end);

  if (start === end) {
    return fullDate(startDate);
  }

  if (
    startDate.year === endDate.year &&
    startDate.month === endDate.month
  ) {
    return `${startDate.day}–${endDate.day} ${monthName(endDate)} ${endDate.year}`;
  }

  if (startDate.year === endDate.year) {
    return `${startDate.day} ${monthName(startDate)}–${endDate.day} ${monthName(endDate)} ${endDate.year}`;
  }

  return `${fullDate(startDate)}–${fullDate(endDate)}`;
}

export function formatCompactRecordDateRange(
  start: string,
  end: string,
): string {
  const startDate = parseCalendarDate(start);
  const endDate = parseCalendarDate(end);

  if (start === end) {
    return `${startDate.day}. ${monthName(startDate)} ${shortYear(startDate.year)}`;
  }

  if (
    startDate.year === endDate.year &&
    startDate.month === endDate.month
  ) {
    return `${startDate.day}.–${endDate.day}. ${monthName(endDate)} ${shortYear(endDate.year)}`;
  }

  if (startDate.year === endDate.year) {
    return `${startDate.day}. ${monthName(startDate)}–${endDate.day}. ${monthName(endDate)} ${shortYear(endDate.year)}`;
  }

  return `${startDate.day}. ${monthName(startDate)} ${shortYear(startDate.year)}–${endDate.day}. ${monthName(endDate)} ${shortYear(endDate.year)}`;
}
