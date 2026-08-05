import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand, CommandContext } from "./command.js";
import type {
  LeaderboardPage,
  LeaderboardScope,
} from "../services/leaderboards/leaderboard-service.js";

const buttonPrefix = "yapper:leaderboard";

const scopeLabels: Record<LeaderboardScope, string> = {
  all: "All-time",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const scopeResetDescriptions: Record<Exclude<LeaderboardScope, "all">, string> = {
  weekly: "Weekly boards reset Monday at 00:00.",
  monthly: "Monthly boards reset on the first day at 00:00.",
  yearly: "Yearly boards reset January 1 at 00:00.",
};

function formatXp(xp: number): string {
  return new Intl.NumberFormat("en-US").format(xp);
}

function formatIsoDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function createPeriodDescription(page: LeaderboardPage): string {
  if (page.scope === "all") {
    return "Adjusted legacy XP + XP earned with Yapper.";
  }

  if (!page.periodStart || !page.periodEnd) {
    throw new Error(`The ${page.scope} leaderboard has no date range.`);
  }

  const start = formatIsoDate(page.periodStart);
  const end = formatIsoDate(page.periodEnd);
  const range = start === end ? start : `${start} - ${end}`;
  const launchNote = page.launchLimited
    ? "\nThis first period starts at Yapper's launch; earlier period activity cannot be reconstructed from all-time MEE6 XP."
    : "";

  return `Yapper XP earned ${range} (${page.timezone}).${launchNote}`;
}

function createButtonCustomId(
  scope: LeaderboardScope,
  page: number,
  requesterId: string,
): string {
  return `${buttonPrefix}:${scope}:${page}:${requesterId}`;
}

export interface LeaderboardButtonRequest {
  scope: LeaderboardScope;
  page: number;
  requesterId: string;
}

export function parseLeaderboardButton(
  customId: string,
): LeaderboardButtonRequest | null {
  const match = /^yapper:leaderboard:(all|weekly|monthly|yearly):(\d{1,2}):(\d{17,20})$/.exec(
    customId,
  );

  if (!match) {
    return null;
  }

  const page = Number(match[2]);

  if (!Number.isInteger(page) || page < 1 || page > 10) {
    return null;
  }

  return {
    scope: match[1] as LeaderboardScope,
    page,
    requesterId: match[3] as string,
  };
}

export function buildLeaderboardResponse(
  page: LeaderboardPage,
  requesterId: string,
): InteractionEditReplyOptions {
  const lines = page.entries.map(
    (entry) => `**#${entry.rank}** <@${entry.userId}> - **${formatXp(entry.xp)} XP**`,
  );
  const rankFieldName =
    page.visibleEntryCount === 0
      ? "Leaderboard"
      : `Ranks ${(page.page - 1) * page.pageSize + 1}-${Math.min(page.page * page.pageSize, page.visibleEntryCount)}`;
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${scopeLabels[page.scope]} Yapper leaderboard`)
    .setDescription(createPeriodDescription(page))
    .addFields({
      name: rankFieldName,
      value: lines.length > 0 ? lines.join("\n") : "No XP has been recorded for this period yet.",
    })
    .setFooter({
      text: `Page ${page.page}/${page.totalPages} - Top ${page.visibleEntryCount} of ${page.participantCount} ranked members${
        page.scope === "all"
          ? ""
          : ` - ${scopeResetDescriptions[page.scope]} ${page.timezone}`
      }`,
    })
    .setTimestamp(page.generatedAt);
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(createButtonCustomId(page.scope, firstPage, requesterId))
      .setLabel("First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(createButtonCustomId(page.scope, previousPage, requesterId))
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(createButtonCustomId(page.scope, nextPage, requesterId))
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page.page === page.totalPages),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(page.scope, page.totalPages, requesterId),
      )
      .setLabel("Last")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === page.totalPages),
  );

  return { embeds: [embed], components: [row] };
}

export async function handleLeaderboardButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): Promise<boolean> {
  const request = parseLeaderboardButton(interaction.customId);

  if (!request) {
    return false;
  }

  if (interaction.user.id !== request.requesterId) {
    await interaction.reply({
      content: "Run `/leaderboard` yourself to open controls you can use.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "Leaderboards can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferUpdate();
  const page = await context.leaderboardService.getPage({
    guildId: interaction.guildId,
    scope: request.scope,
    page: request.page,
    now: new Date(),
  });
  await interaction.editReply(
    buildLeaderboardResponse(page, request.requesterId),
  );
  return true;
}

export const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the server's Yapper XP leaderboard.")
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Choose all-time or a current calendar period.")
        .addChoices(
          { name: "All time", value: "all" },
          { name: "Weekly", value: "weekly" },
          { name: "Monthly", value: "monthly" },
          { name: "Yearly", value: "yearly" },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Choose page 1-10; each page shows 10 members.")
        .setMinValue(1)
        .setMaxValue(10),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Leaderboards can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const scope = (interaction.options.getString("scope") ??
      "all") as LeaderboardScope;
    const page = await context.leaderboardService.getPage({
      guildId: interaction.guildId,
      scope,
      page: interaction.options.getInteger("page") ?? 1,
      now: new Date(),
    });

    await interaction.editReply(
      buildLeaderboardResponse(page, interaction.user.id),
    );
  },
};
