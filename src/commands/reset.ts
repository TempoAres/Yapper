import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import type { LeaderboardResetSchedule } from "../services/leaderboards/leaderboard-service.js";

function discordTimestamp(date: Date, style: "F" | "R"): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function resetValue(date: Date): string {
  return `${discordTimestamp(date, "F")}\n**${discordTimestamp(date, "R")}**`;
}

export function buildResetInfoResponse(
  schedule: LeaderboardResetSchedule,
): InteractionEditReplyOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(yapperColors.blue)
        .setTitle("Leaderboard resets")
        .setDescription(
          `Timezone: **${schedule.timezone}**\nDiscord updates the relative countdowns automatically. Run \`/reset info\` again after a reset to show the following one.`,
        )
        .addFields(
          { name: "Weekly", value: resetValue(schedule.weekly) },
          { name: "Monthly", value: resetValue(schedule.monthly) },
          { name: "Yearly", value: resetValue(schedule.yearly) },
        )
        .setFooter({
          text: "All-time, XP, wins, activity-record, and reaction leaderboards never reset",
        }),
    ],
  };
}

export const resetCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Show when Yapper's leaderboards next reset.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("info")
        .setDescription("Show the next weekly, monthly, and yearly resets."),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Leaderboard reset times can only be viewed inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const schedule = await context.leaderboardService.getResetSchedule({
      guildId: interaction.guildId,
      now: new Date(),
    });
    await interaction.editReply(buildResetInfoResponse(schedule));
  },
};
