import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";

import type { CommandContext } from "./command.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";
import { buildProgressBar } from "../services/xp/progress-bar.js";

function formatXp(xp: number): string {
  return new Intl.NumberFormat("en-US").format(xp);
}

export function createProgressEmbed(
  user: User,
  stats: Awaited<ReturnType<CommandContext["memberXpService"]["getMemberStats"]>>,
  includeCurveExplanation: boolean,
): EmbedBuilder {
  const progress = calculateLevelProgress(stats.allTimeXp);
  const progressBar = buildProgressBar(progress.progress);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: user.globalName ?? user.username,
      iconURL: user.displayAvatarURL(),
    })
    .setTitle("Yapper level progress")
    .addFields(
      { name: "Level", value: String(progress.level), inline: true },
      {
        name: "Server rank",
        value: stats.rank === null ? "Unranked" : `#${stats.rank}`,
        inline: true,
      },
      {
        name: "Total XP",
        value: formatXp(stats.allTimeXp),
        inline: true,
      },
      {
        name: `Progress to level ${progress.level + 1}`,
        value: `${progressBar}\n${formatXp(progress.xpInCurrentLevel)} / ${formatXp(progress.xpForNextLevel)} XP \u2022 ${formatXp(progress.xpNeededForNextLevel)} XP to go`,
      },
    );

  if (includeCurveExplanation) {
    embed.addFields({
      name: "Level curve",
      value: "XP to next level = round(500 + 70 × level + 0.22 × level²)",
    });
  }

  return embed;
}

export async function executeProgressCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  includeCurveExplanation = false,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const user = interaction.options.getUser("user") ?? interaction.user;
  const stats = await context.memberXpService.getMemberStats(
    interaction.guildId,
    user.id,
  );

  await interaction.editReply({
    embeds: [createProgressEmbed(user, stats, includeCurveExplanation)],
  });
}
