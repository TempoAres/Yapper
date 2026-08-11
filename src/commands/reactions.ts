import {
  ActionRowBuilder,
  AttachmentBuilder,
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
import { yapperColors } from "../presentation/colors.js";
import {
  renderLeaderboardImage,
  resolveLeaderboardProfiles,
  type LeaderboardImageRow,
  type LeaderboardMemberProfile,
} from "../services/leaderboards/leaderboard-image.js";
import type {
  ReactionLeaderboardMetric,
  ReactionLeaderboardPage,
} from "../services/reactions/reaction-service.js";

const buttonPrefix = "yapper:react";
type ReactionButtonAction = "first" | "previous" | "next" | "last";

const metricLabels: Record<ReactionLeaderboardMetric, string> = {
  received: "Reactions Received",
  given: "Reactions Given",
};

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

export function createReactionLeaderboardImageRows(
  page: ReactionLeaderboardPage,
): readonly LeaderboardImageRow[] {
  return page.entries.map((entry) => ({
    rank: entry.rank,
    userId: entry.userId,
    detail: formatCount(entry.count),
  }));
}

function buildNavigationRow(
  page: ReactionLeaderboardPage,
  requesterId: string,
): ActionRowBuilder<ButtonBuilder> {
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("first", page.metric, firstPage, requesterId),
      )
      .setLabel("First")
      .setEmoji("⏮️")
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
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("next", page.metric, nextPage, requesterId),
      )
      .setLabel("Next")
      .setEmoji("▶️")
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
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === page.totalPages),
  );
}

export async function buildReactionLeaderboardResponse(
  page: ReactionLeaderboardPage,
  requesterId: string,
  profiles: ReadonlyMap<string, LeaderboardMemberProfile> = new Map(),
): Promise<InteractionEditReplyOptions> {
  const image = await renderLeaderboardImage({
    rows: createReactionLeaderboardImageRows(page),
    profiles,
    emptyMessage: "No eligible reactions have been recorded yet.",
  });
  const fileName = `yapper-reactions-${page.metric}-page-${page.page}.png`;
  const embed = new EmbedBuilder()
    .setColor(
      page.metric === "received" ? yapperColors.violet : yapperColors.magenta,
    )
    .setTitle(metricLabels[page.metric])
    .setImage(`attachment://${fileName}`)
    .setFooter({
      text: `Page ${page.page}/${page.totalPages} • Top ${page.visibleEntryCount} of ${page.participantCount} • Tracking starts with this update`,
    })
    .setTimestamp(page.generatedAt);

  return {
    embeds: [embed],
    components: [buildNavigationRow(page, requesterId)],
    files: [new AttachmentBuilder(image, { name: fileName })],
    attachments: [],
  };
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
  const profiles = await resolveLeaderboardProfiles(
    interaction.client,
    page.entries.map((entry) => entry.userId),
  );
  await interaction.editReply(
    await buildReactionLeaderboardResponse(
      page,
      request.requesterId,
      profiles,
    ),
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
    const profiles = await resolveLeaderboardProfiles(
      interaction.client,
      page.entries.map((entry) => entry.userId),
    );
    await interaction.editReply(
      await buildReactionLeaderboardResponse(page, interaction.user.id, profiles),
    );
  },
};
