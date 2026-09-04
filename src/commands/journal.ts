import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { BotCommand, CommandContext } from "./command.js";
import type { JournalSession } from "../services/journal/journal-service.js";
import { nextLocalMidnight } from "../services/leaderboards/leaderboard-period.js";

function timestamp(date: Date, style: "F" | "R"): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function hasAdministratorPermission(
  interaction: ChatInputCommandInteraction,
): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

function configuredTarget(context: CommandContext): string | undefined {
  return context.journalConfig.targetUserId;
}

export function buildJournalStatusResponse(session: JournalSession): string {
  const state =
    session.status === "active"
      ? `recording until ${timestamp(session.endsAt, "F")} (${timestamp(session.endsAt, "R")})`
      : session.status === "summarizing"
        ? "being summarized"
        : "waiting for DM delivery";

  return [
    `Personal journal **#${session.id}** is ${state}.`,
    `Recorded messages: **${session.messageCount.toLocaleString("en-US")}**`,
    `Started: ${timestamp(session.startedAt, "F")}`,
    "Daily retros continue automatically; Monday midnight sends the weekly report instead. Use `/journal cancel` to stop.",
  ].join("\n");
}

export const journalCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("journal")
    .setDescription("Manage the private daily personal journal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Start continuous private summaries at local midnight."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show the current private journal status."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Cancel the journal and permanently delete its messages."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("summarize-now")
        .setDescription("Finish recording and send the private summary now."),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId || !hasAdministratorPermission(interaction)) {
      await interaction.reply({
        content: "This command is restricted to server administrators.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUserId = configuredTarget(context);

    if (!targetUserId || !context.journalConfig.summarizationConfigured) {
      await interaction.reply({
        content:
          "Personal journal summarization is not configured. Set JOURNAL_USER_ID and the OPENAI_API_KEY secret on the VPS first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === "status") {
      const session = await context.journalService.getCurrent({
        guildId: interaction.guildId,
        userId: targetUserId,
      });
      await interaction.editReply({
        content: session
          ? buildJournalStatusResponse(session)
          : "There is no active personal journal.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (subcommand === "cancel") {
      const cancelled = await context.journalService.cancel({
        guildId: interaction.guildId,
        userId: targetUserId,
      });
      await interaction.editReply({
        content: cancelled
          ? "The personal journal was cancelled and its recorded messages were deleted from Yapper's live database."
          : "There is no active personal journal to cancel.",
      });
      return;
    }

    if (subcommand === "summarize-now") {
      const queued = await context.journalService.finishNow({
        guildId: interaction.guildId,
        userId: targetUserId,
        now: new Date(),
      });
      await interaction.editReply({
        content: queued
          ? "Yapper is preparing a private DM summary now and will keep recording continuously."
          : "There is no actively recording journal to summarize.",
      });
      return;
    }

    const startedAt = new Date();

    try {
      const session = await context.journalService.start({
        guildId: interaction.guildId,
        userId: targetUserId,
        startedAt,
        endsAt: nextLocalMidnight(startedAt, context.journalConfig.timezone),
      });
      await interaction.editReply({
        content: [
          `Started personal journal **#${session.id}** for <@${targetUserId}>.`,
          `The first retro is at ${timestamp(session.endsAt, "F")} (${timestamp(session.endsAt, "R")}); daily retros continue at midnight, with a weekly report replacing Sunday's retro.`,
          "Summaries will be sent only to that user's DMs.",
        ].join("\n"),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }

      await interaction.editReply({ content: error.message });
    }
  },
};
