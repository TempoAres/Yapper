import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";

import type { CommandContext } from "./command.js";
import { describeRoleSync } from "./xp-roles.js";
import { yapperColors } from "../presentation/colors.js";
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
    .setColor(yapperColors.violet)
    .setAuthor({
      name: user.globalName ?? user.username,
      iconURL: user.displayAvatarURL(),
    })
    .setTitle("Moderator XP view")
    .addFields(
      { name: "Editable XP", value: formatXp(stats.newBotXp), inline: true },
      { name: "Total XP", value: formatXp(stats.allTimeXp), inline: true },
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
  let roleSyncDescription: string | null = null;

  if (result.status === "applied") {
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null);

    if (!member) {
      roleSyncDescription =
        "The XP change succeeded, but the member could not be fetched for role synchronization.";
    } else {
      try {
        roleSyncDescription = describeRoleSync(
          await context.roleRewardCoordinator.syncMember(member),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        roleSyncDescription = `The XP change succeeded, but role synchronization failed: ${detail}`;
      }
    }
  }

  const embed = new EmbedBuilder()
    .setColor(result.delta >= 0 ? 0x57f287 : 0xed4245)
    .setTitle(
      result.status === "duplicate"
        ? "XP change already applied"
        : "Yapper XP updated",
    )
    .setDescription(`${user}'s XP and level have been recalculated.`)
    .addFields(
      { name: "Operation", value: subcommand, inline: true },
      { name: "Change", value: `${formatSignedXp(result.delta)} XP`, inline: true },
      { name: "Before", value: formatXp(result.previousXp), inline: true },
      { name: "After", value: formatXp(result.newXp), inline: true },
      { name: "Total XP", value: formatXp(stats.allTimeXp), inline: true },
      ...(reason ? [{ name: "Reason", value: reason.slice(0, 200) }] : []),
      ...(roleSyncDescription
        ? [{ name: "Stacked role sync", value: roleSyncDescription }]
        : []),
    )
    .setFooter({
      text: "Audited change - period activity leaderboards are unchanged",
    });

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}
