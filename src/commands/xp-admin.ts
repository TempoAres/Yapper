import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";

import type { CommandContext } from "./command.js";
import type { AdminXpOperation } from "../services/xp/admin-xp-service.js";

export type AdminXpSubcommand = "view" | AdminXpOperation;

function formatXp(xp: number): string {
  return new Intl.NumberFormat("en-US").format(xp);
}

function formatSignedXp(xp: number): string {
  return `${xp >= 0 ? "+" : "-"}${formatXp(Math.abs(xp))}`;
}

export function canManageXp(
  interaction: ChatInputCommandInteraction,
): boolean {
  const permissions = interaction.memberPermissions;
  return Boolean(
    permissions?.has(PermissionFlagsBits.Administrator) ||
      permissions?.has(PermissionFlagsBits.ManageGuild),
  );
}

function createAdminViewEmbed(
  user: User,
  stats: Awaited<ReturnType<CommandContext["memberXpService"]["getMemberStats"]>>,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: user.globalName ?? user.username,
      iconURL: user.displayAvatarURL(),
    })
    .setTitle("Moderator XP view")
    .addFields(
      { name: "Yapper XP", value: formatXp(stats.newBotXp), inline: true },
      {
        name: "Adjusted legacy XP",
        value: formatXp(stats.legacyXpAdjusted),
        inline: true,
      },
      {
        name: "Raw legacy XP",
        value: formatXp(stats.legacyXpRaw),
        inline: true,
      },
      { name: "All-time XP", value: formatXp(stats.allTimeXp), inline: true },
      {
        name: "Server rank",
        value: stats.rank === null ? "Unranked" : `#${stats.rank}`,
        inline: true,
      },
    )
    .setFooter({ text: "Private moderator view" });
}

export async function executeAdminXpCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  subcommand: AdminXpSubcommand,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "XP administration can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManageXp(interaction)) {
    await interaction.reply({
      content: "You need **Manage Server** permission to change Yapper XP.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "view") {
    const stats = await context.memberXpService.getMemberStats(
      interaction.guildId,
      user.id,
    );
    await interaction.editReply({ embeds: [createAdminViewEmbed(user, stats)] });
    return;
  }

  if (user.bot) {
    await interaction.editReply(
      "Bots cannot receive Yapper XP through moderator commands.",
    );
    return;
  }

  const amount = interaction.options.getInteger("amount", true);
  const reason = interaction.options.getString("reason");
  const result = await context.adminXpService.adjust({
    guildId: interaction.guildId,
    targetUserId: user.id,
    moderatorUserId: interaction.user.id,
    channelId: interaction.channelId,
    discordInteractionId: interaction.id,
    operation: subcommand,
    amount,
    reason,
    createdAt: new Date(),
  });

  if (result.status === "insufficient") {
    await interaction.editReply(
      `${user} only has **${formatXp(result.previousXp)} Yapper XP**. Removing ${formatXp(result.requestedAmount)} would make it negative, so nothing changed.`,
    );
    return;
  }

  if (result.status === "unchanged") {
    await interaction.editReply(
      `${user} already has **${formatXp(result.newXp)} Yapper XP**. Nothing changed.`,
    );
    return;
  }

  const stats = await context.memberXpService.getMemberStats(
    interaction.guildId,
    user.id,
  );
  const embed = new EmbedBuilder()
    .setColor(result.delta >= 0 ? 0x57f287 : 0xed4245)
    .setTitle(
      result.status === "duplicate"
        ? "XP change already applied"
        : "Yapper XP updated",
    )
    .setDescription(`${user}'s imported legacy baseline was not changed.`)
    .addFields(
      { name: "Operation", value: subcommand, inline: true },
      { name: "Change", value: `${formatSignedXp(result.delta)} XP`, inline: true },
      { name: "Before", value: formatXp(result.previousXp), inline: true },
      { name: "After", value: formatXp(result.newXp), inline: true },
      { name: "All-time XP", value: formatXp(stats.allTimeXp), inline: true },
      ...(reason ? [{ name: "Reason", value: reason.slice(0, 200) }] : []),
    )
    .setFooter({
      text: "Audited change - period activity leaderboards are unchanged",
    });

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}
