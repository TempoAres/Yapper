import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type User,
} from "discord.js";

import type { CommandContext } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";
import { buildProgressBar } from "../services/xp/progress-bar.js";
import {
  resolveLeaderboardProfiles,
  type LeaderboardMemberProfile,
} from "../services/leaderboards/leaderboard-image.js";
import { renderRankImage } from "../services/leaderboards/rank-image.js";

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
    .setColor(yapperColors.violet)
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

export async function buildRankResponse(
  user: User,
  stats: Awaited<ReturnType<CommandContext["memberXpService"]["getMemberStats"]>>,
  profile: LeaderboardMemberProfile,
): Promise<InteractionEditReplyOptions> {
  const progress = calculateLevelProgress(stats.allTimeXp);
  const image = await renderRankImage({
    profile: {
      ...profile,
      displayName: user.globalName ?? user.username,
    },
    rank: stats.rank,
    level: progress.level,
    totalXp: stats.allTimeXp,
    xpInCurrentLevel: progress.xpInCurrentLevel,
    xpForNextLevel: progress.xpForNextLevel,
    xpNeededForNextLevel: progress.xpNeededForNextLevel,
    progress: progress.progress,
  });
  const fileName = `yapper-rank-${user.id}.png`;
  const embed = new EmbedBuilder()
    .setColor(yapperColors.cyan)
    .setTitle("Yapper Rank")
    .setImage(`attachment://${fileName}`);

  return {
    embeds: [embed],
    files: [new AttachmentBuilder(image, { name: fileName })],
    attachments: [],
  };
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

  if (includeCurveExplanation) {
    await interaction.editReply({
      embeds: [createProgressEmbed(user, stats, true)],
    });
    return;
  }

  const profiles = await resolveLeaderboardProfiles(interaction.client, [user.id]);
  const profile = profiles.get(user.id) ?? {
    userId: user.id,
    displayName: user.globalName ?? user.username,
    avatarDataUri: null,
  };
  await interaction.editReply(await buildRankResponse(user, stats, profile));
}
