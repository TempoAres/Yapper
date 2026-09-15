import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand, CommandContext } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import { formatCalendarDateRange } from "../presentation/date-format.js";
import type {
  LeaderboardEntry,
  LeaderboardPage,
  LeaderboardService,
} from "../services/leaderboards/leaderboard-service.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";

type LeaderboardSummaryScope = "daily" | "weekly" | "monthly";

export interface LeaderboardSummaryPages {
  daily: LeaderboardPage;
  weekly: LeaderboardPage;
  monthly: LeaderboardPage;
}

const summaryScopes: readonly LeaderboardSummaryScope[] = [
  "daily",
  "weekly",
  "monthly",
];

const scopeLabels: Record<LeaderboardSummaryScope, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const rankMarkers = ["🥇", "🥈", "🥉"] as const;

function formatXp(xp: number): string {
  return new Intl.NumberFormat("en-US").format(xp);
}

function levelGain(entry: LeaderboardEntry): number {
  const currentLevel = calculateLevelProgress(entry.allTimeXp).level;
  const startingXp = Math.max(0, entry.allTimeXp - entry.xp);
  const startingLevel = calculateLevelProgress(startingXp).level;
  return Math.max(0, currentLevel - startingLevel);
}

function fieldName(page: LeaderboardPage): string {
  const label = scopeLabels[page.scope as LeaderboardSummaryScope];

  if (!page.periodStart || !page.periodEnd) {
    return label;
  }

  return `${label} • ${formatCalendarDateRange(page.periodStart, page.periodEnd)}`;
}

function fieldValue(page: LeaderboardPage): string {
  const entries = page.entries.slice(0, 3);

  if (entries.length === 0) {
    return "No XP earned in this period yet.";
  }

  return entries
    .map(
      (entry, index) =>
        `${rankMarkers[index] ?? `#${entry.rank}`} <@${entry.userId}> • +${levelGain(entry)} LVL • +${formatXp(entry.xp)} XP`,
    )
    .join("\n");
}

export function buildLeaderboardSummaryResponse(
  pages: LeaderboardSummaryPages,
): InteractionEditReplyOptions {
  const embed = new EmbedBuilder()
    .setColor(yapperColors.cyan)
    .setTitle("Leaderboard Snapshot")
    .setDescription("Current top three activity leaders across each period.")
    .addFields(
      summaryScopes.map((scope) => ({
        name: fieldName(pages[scope]),
        value: fieldValue(pages[scope]),
        inline: false,
      })),
    )
    .setFooter({ text: "Daily • Weekly • Monthly" })
    .setTimestamp(pages.daily.generatedAt);

  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

export async function loadLeaderboardSummaryPages(
  service: LeaderboardService,
  guildId: string,
  now = new Date(),
): Promise<LeaderboardSummaryPages> {
  const [daily, weekly, monthly] = await Promise.all([
    service.getPage({ guildId, scope: "daily", page: 1, now }),
    service.getPage({ guildId, scope: "weekly", page: 1, now }),
    service.getPage({ guildId, scope: "monthly", page: 1, now }),
  ]);

  return { daily, weekly, monthly };
}

export const leaderboardSummaryCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("lbs")
    .setDescription("Show the current daily, weekly, and monthly top three."),
  async execute(interaction, context: CommandContext) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Leaderboard summaries can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const pages = await loadLeaderboardSummaryPages(
      context.leaderboardService,
      interaction.guildId,
    );
    await interaction.editReply(buildLeaderboardSummaryResponse(pages));
  },
};
