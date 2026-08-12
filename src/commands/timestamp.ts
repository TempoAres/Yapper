import {
  MessageFlags,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseDate(input: string): Pick<LocalDateTimeParts, "year" | "month" | "day"> {
  const value = input.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const europeanMatch = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
  const year = Number(isoMatch?.[1] ?? europeanMatch?.[3]);
  const month = Number(isoMatch?.[2] ?? europeanMatch?.[2]);
  const day = Number(isoMatch?.[3] ?? europeanMatch?.[1]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    !Number.isInteger(year) ||
    year < 1970 ||
    year > 9999 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError(
      "Enter a valid date as `YYYY-MM-DD` or `DD.MM.YYYY`.",
    );
  }

  return { year, month, day };
}

function parseTime(input: string): Pick<LocalDateTimeParts, "hour" | "minute" | "second"> {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  const second = Number(match?.[3] ?? 0);

  if (
    !match ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(second) ||
    second < 0 ||
    second > 59
  ) {
    throw new RangeError(
      "Enter a valid 24-hour time as `HH:MM` or `HH:MM:SS`.",
    );
  }

  return { hour, minute, second };
}

function localParts(date: Date, timezone: string): LocalDateTimeParts {
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

  return {
    year: valueFor("year"),
    month: valueFor("month"),
    day: valueFor("day"),
    hour: valueFor("hour"),
    minute: valueFor("minute"),
    second: valueFor("second"),
  };
}

function timezoneOffsetMilliseconds(date: Date, timezone: string): number {
  const parts = localParts(date, timezone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const wholeSecondInstant = Math.floor(date.getTime() / 1_000) * 1_000;

  return representedAsUtc - wholeSecondInstant;
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

export function resolveDiscordTimestampInput(input: {
  date: string;
  time: string;
  timezone: string;
}): Date {
  const desired: LocalDateTimeParts = {
    ...parseDate(input.date),
    ...parseTime(input.time),
  };
  const localTimeAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  const offsets = new Set<number>();

  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(
      timezoneOffsetMilliseconds(
        new Date(localTimeAsUtc + hours * 60 * 60 * 1_000),
        input.timezone,
      ),
    );
  }

  const matches = [...offsets]
    .map((offset) => new Date(localTimeAsUtc - offset))
    .filter((candidate) =>
      sameParts(localParts(candidate, input.timezone), desired),
    )
    .sort((left, right) => left.getTime() - right.getTime());

  if (matches.length === 0) {
    throw new RangeError(
      "That local time does not exist because the clocks change then. Choose another time.",
    );
  }

  if (matches.length > 1) {
    throw new RangeError(
      "That local time occurs twice because the clocks change then. Choose a time before 02:00 or after 03:00.",
    );
  }

  return matches[0] as Date;
}

function discordTimestamp(date: Date, style: "F" | "R"): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

export function buildTimestampResponse(
  date: Date,
  timezone: string,
): InteractionEditReplyOptions {
  const exact = discordTimestamp(date, "F");
  const relative = discordTimestamp(date, "R");

  return {
    content: [
      `**Date and time:** ${exact}`,
      `**Relative:** ${relative}`,
      `**Copy exact:** \`${exact}\``,
      `**Copy relative:** \`${relative}\``,
      `-# Interpreted in ${timezone}`,
    ].join("\n"),
  };
}

export const timestampCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("timestamp")
    .setDescription("Create a Discord timestamp from a date and time.")
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription("Date as YYYY-MM-DD or DD.MM.YYYY.")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription("24-hour time as HH:MM.")
        .setRequired(true),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Timestamps can only be created inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const schedule = await context.leaderboardService.getResetSchedule({
      guildId: interaction.guildId,
      now: new Date(),
    });

    try {
      const date = resolveDiscordTimestampInput({
        date: interaction.options.getString("date", true),
        time: interaction.options.getString("time", true),
        timezone: schedule.timezone,
      });
      await interaction.editReply(buildTimestampResponse(date, schedule.timezone));
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }

      await interaction.editReply({
        content: error.message,
      });
    }
  },
};
