import {
  MessageFlags,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { resolveDiscordTimestampInput } from "./timestamp.js";
import type { Reminder } from "../services/reminders/reminder-service.js";

function discordTimestamp(date: Date, style: "F" | "R"): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function reminderPreview(message: string): string {
  return message.length <= 100 ? message : `${message.slice(0, 97)}...`;
}

export function buildReminderCreatedResponse(
  reminder: Reminder,
  timezone: string,
): InteractionEditReplyOptions {
  return {
    content: [
      `Reminder **#${reminder.id}** set for ${discordTimestamp(reminder.remindAt, "F")} (${discordTimestamp(reminder.remindAt, "R")}).`,
      `I’ll ping you here with: ${reminder.message}`,
      `-# Interpreted in ${timezone}`,
    ].join("\n"),
    allowedMentions: { parse: [] },
  };
}

export function buildReminderListResponse(
  reminders: readonly Reminder[],
): InteractionEditReplyOptions {
  if (reminders.length === 0) {
    return {
      content: "You have no pending reminders in this server.",
    };
  }

  const lines = reminders.map(
    (reminder) =>
      `**#${reminder.id}** • ${discordTimestamp(reminder.remindAt, "F")} (${discordTimestamp(reminder.remindAt, "R")})\n${reminderPreview(reminder.message)}`,
  );

  return {
    content: `**Your pending reminders**\n\n${lines.join("\n\n")}`,
    allowedMentions: { parse: [] },
  };
}

export const reminderCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Create and manage reminders that ping you.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set a reminder in this channel.")
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
        )
        .addStringOption((option) =>
          option
            .setName("message")
            .setDescription("What should I remind you about?")
            .setMinLength(1)
            .setMaxLength(500)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List your pending reminders in this server."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Cancel one of your pending reminders.")
        .addIntegerOption((option) =>
          option
            .setName("id")
            .setDescription("Reminder ID shown by set or list.")
            .setMinValue(1)
            .setRequired(true),
        ),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "Reminders can only be managed inside a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === "list") {
      const reminders = await context.reminderService.list({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        limit: 10,
      });
      await interaction.editReply(buildReminderListResponse(reminders));
      return;
    }

    if (subcommand === "cancel") {
      const reminderId = interaction.options.getInteger("id", true);
      const cancelled = await context.reminderService.cancel({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        reminderId,
      });
      await interaction.editReply({
        content: cancelled
          ? `Reminder **#${reminderId}** cancelled.`
          : `I couldn’t find pending reminder **#${reminderId}** belonging to you in this server.`,
      });
      return;
    }

    const schedule = await context.leaderboardService.getResetSchedule({
      guildId: interaction.guildId,
      now: new Date(),
    });

    try {
      const remindAt = resolveDiscordTimestampInput({
        date: interaction.options.getString("date", true),
        time: interaction.options.getString("time", true),
        timezone: schedule.timezone,
      });

      if (remindAt.getTime() <= Date.now()) {
        throw new RangeError("Choose a reminder date and time in the future.");
      }

      const reminder = await context.reminderService.create({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        channelId: interaction.channelId,
        message: interaction.options.getString("message", true),
        remindAt,
      });
      await interaction.editReply(
        buildReminderCreatedResponse(reminder, schedule.timezone),
      );
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
