import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import type { RecentXpEntry } from "../services/xp/recent-xp-service.js";

function canDebugXp(interaction: ChatInputCommandInteraction): boolean {
  const permissions = interaction.memberPermissions;
  return Boolean(
    permissions?.has(PermissionFlagsBits.Administrator) ||
      permissions?.has(PermissionFlagsBits.ManageGuild) ||
      permissions?.has(PermissionFlagsBits.ManageMessages),
  );
}

function formatSignedXp(amount: number): string {
  const formatted = new Intl.NumberFormat("en-US").format(Math.abs(amount));
  return `${amount >= 0 ? "+" : "-"}${formatted} XP`;
}

function buildEntryValue(entry: RecentXpEntry, guildId: string): string {
  const timestamp = Math.floor(entry.createdAt.getTime() / 1_000);
  const location =
    entry.channelId && entry.messageId
      ? `<#${entry.channelId}> - [Jump to message](https://discord.com/channels/${guildId}/${entry.channelId}/${entry.messageId})`
      : entry.channelId
        ? `<#${entry.channelId}>`
        : "No channel recorded";
  const actor = entry.actorUserId ? `\nModerator: <@${entry.actorUserId}>` : "";
  const note = entry.note
    ? `\nReason: ${escapeMarkdown(entry.note).slice(0, 200)}`
    : "";

  return `<t:${timestamp}:f> - ${location}${actor}${note}`;
}

export function buildRecentXpResponse(input: {
  guildId: string;
  displayName: string;
  avatarUrl: string;
  entries: readonly RecentXpEntry[];
  generatedAt: Date;
}): InteractionEditReplyOptions {
  const embed = new EmbedBuilder()
    .setColor(yapperColors.violet)
    .setAuthor({ name: input.displayName, iconURL: input.avatarUrl })
    .setTitle("Recent XP events")
    .setDescription(
      input.entries.length === 0
        ? "No XP events have been recorded for this member."
        : "The newest ten awards or moderator adjustments are shown first.",
    )
    .setFooter({
      text: "Private moderator view - message content is never stored",
    })
    .setTimestamp(input.generatedAt);

  if (input.entries.length > 0) {
    embed.addFields(
      input.entries.map((entry) => ({
        name: `${formatSignedXp(entry.amount)} - ${entry.source}`,
        value: buildEntryValue(entry, input.guildId),
      })),
    );
  }

  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

export const recentCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("recent")
    .setDescription("Private moderator debugging tools.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("xp")
        .setDescription("Show a member's ten most recent XP events.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to inspect; defaults to you."),
        ),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Recent XP can only be viewed inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!canDebugXp(interaction)) {
      await interaction.reply({
        content:
          "You need **Manage Messages** or **Manage Server** permission to inspect recent XP.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser("user") ?? interaction.user;
    const entries = await context.recentXpService.getRecent({
      guildId: interaction.guildId,
      userId: user.id,
      limit: 10,
    });

    await interaction.editReply(
      buildRecentXpResponse({
        guildId: interaction.guildId,
        displayName: user.globalName ?? user.username,
        avatarUrl: user.displayAvatarURL(),
        entries,
        generatedAt: new Date(),
      }),
    );
  },
};
