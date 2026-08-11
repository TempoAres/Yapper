import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import type { BotCommand, CommandContext } from "./command.js";
import type {
  ReactionLeaderboardMetric,
  ReactionLeaderboardPage,
} from "../services/reactions/reaction-service.js";

const buttonPrefix = "yapper:react";
type ReactionButtonAction = "first" | "previous" | "next" | "last";

const metricLabels: Record<ReactionLeaderboardMetric, string> = {
  received: "Reactions received",
  given: "Reactions given",
};

function medalForRank(rank: number): string {
  return (
    {
      1: "\u{1F947}",
      2: "\u{1F948}",
      3: "\u{1F949}",
    }[rank] ?? `**#${rank}**`
  );
}

function formatCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

function createButtonCustomId(
  action: ReactionButtonAction,
  metric: ReactionLeaderboardMetric,
  page: number,
  requesterId: string,
): string {
  return `${buttonPrefix}:${action}:${metric}:${page}:${requesterId}`;
}

export interface ReactionButtonRequest {
  action: ReactionButtonAction;
  metric: ReactionLeaderboardMetric;
  page: number;
  requesterId: string;
}

export function parseReactionButton(
  customId: string,
): ReactionButtonRequest | null {
  const match = /^yapper:react:(first|previous|next|last):(received|given):(\d{1,2}):(\d{17,20})$/.exec(
    customId,
  );

  if (!match) {
    return null;
  }

  const page = Number(match[3]);

  if (!Number.isInteger(page) || page < 1 || page > 10) {
    return null;
  }

  return {
    action: match[1] as ReactionButtonAction,
    metric: match[2] as ReactionLeaderboardMetric,
    page,
    requesterId: match[4] as string,
  };
}

export function buildReactionLeaderboardResponse(
  page: ReactionLeaderboardPage,
  requesterId: string,
): InteractionEditReplyOptions {
  const lines = page.entries.map(
    (entry) =>
      `${medalForRank(entry.rank)} <@${entry.userId}> \u2022 **${formatCount(entry.count)}**`,
  );
  const embed = new EmbedBuilder()
    .setColor(page.metric === "received" ? 0xeb459e : 0xfee75c)
    .setTitle(metricLabels[page.metric])
    .setDescription(
      page.metric === "received"
        ? "The members whose messages currently hold the most reactions."
        : "The members who have placed the most currently active reactions.",
    )
    .addFields({
      name:
        page.visibleEntryCount === 0
          ? "Standings"
          : `Ranks ${(page.page - 1) * page.pageSize + 1}\u2013${Math.min(
              page.page * page.pageSize,
              page.visibleEntryCount,
            )}`,
      value:
        lines.length > 0
          ? lines.join("\n")
          : "No eligible reactions have been recorded yet.",
    })
    .setFooter({
      text: `Page ${page.page}/${page.totalPages} \u2022 Top ${page.visibleEntryCount} of ${page.participantCount} \u2022 Tracking starts with this update`,
    })
    .setTimestamp(page.generatedAt);
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("first", page.metric, firstPage, requesterId),
      )
      .setLabel("First")
      .setEmoji("\u23EE\uFE0F")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "previous",
          page.metric,
          previousPage,
          requesterId,
        ),
      )
      .setLabel("Back")
      .setEmoji("\u25C0\uFE0F")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("next", page.metric, nextPage, requesterId),
      )
      .setLabel("Next")
      .setEmoji("\u25B6\uFE0F")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page.page === page.totalPages),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "last",
          page.metric,
          page.totalPages,
          requesterId,
        ),
      )
      .setLabel("Last")
      .setEmoji("\u23ED\uFE0F")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === page.totalPages),
  );

  return { embeds: [embed], components: [row] };
}

async function loadPage(
  context: CommandContext,
  input: {
    guildId: string;
    metric: ReactionLeaderboardMetric;
    page: number;
  },
): Promise<ReactionLeaderboardPage> {
  return context.reactionService.getLeaderboardPage({
    ...input,
    now: new Date(),
  });
}

export async function handleReactionLeaderboardButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): Promise<boolean> {
  const request = parseReactionButton(interaction.customId);

  if (!request) {
    return false;
  }

  if (interaction.user.id !== request.requesterId) {
    await interaction.reply({
      content: `Run \`/react ${request.metric}\` yourself to open controls you can use.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "Reaction leaderboards can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferUpdate();
  const page = await loadPage(context, {
    guildId: interaction.guildId,
    metric: request.metric,
    page: request.page,
  });
  await interaction.editReply(
    buildReactionLeaderboardResponse(page, request.requesterId),
  );
  return true;
}

function configureMetricSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  metric: ReactionLeaderboardMetric,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName(metric)
    .setDescription(`Show the reactions-${metric} leaderboard.`)
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Optional page from 1 to 10.")
        .setMinValue(1)
        .setMaxValue(10),
    );
}

export const reactionCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("react")
    .setDescription("Show the server reaction leaderboards.")
    .addSubcommand((subcommand) =>
      configureMetricSubcommand(subcommand, "received"),
    )
    .addSubcommand((subcommand) =>
      configureMetricSubcommand(subcommand, "given"),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Reaction leaderboards can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const metric = interaction.options.getSubcommand(
      true,
    ) as ReactionLeaderboardMetric;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      metric,
      page: interaction.options.getInteger("page") ?? 1,
    });
    await interaction.editReply(
      buildReactionLeaderboardResponse(page, interaction.user.id),
    );
  },
};
