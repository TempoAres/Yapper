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
  LeaderboardRecordScope,
  LeaderboardWinPage,
} from "../services/leaderboards/leaderboard-service.js";

const buttonPrefix = "yapper:wins";
type WinButtonAction = "first" | "previous" | "next" | "last";

const scopeLabels: Record<LeaderboardRecordScope, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function formatWins(wins: number): string {
  return `${new Intl.NumberFormat("en-US").format(wins)} ${wins === 1 ? "win" : "wins"}`;
}

function createButtonCustomId(
  action: WinButtonAction,
  scope: LeaderboardRecordScope,
  page: number,
  requesterId: string,
): string {
  return `${buttonPrefix}:${action}:${scope}:${page}:${requesterId}`;
}

export interface WinButtonRequest {
  action: WinButtonAction;
  scope: LeaderboardRecordScope;
  page: number;
  requesterId: string;
}

export function parseWinButton(customId: string): WinButtonRequest | null {
  const match = /^yapper:wins:(first|previous|next|last):(weekly|monthly|yearly):(\d{1,2}):(\d{17,20})$/.exec(
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
    action: match[1] as WinButtonAction,
    scope: match[2] as LeaderboardRecordScope,
    page,
    requesterId: match[4] as string,
  };
}

export function createWinLeaderboardImageRows(
  page: LeaderboardWinPage,
): readonly LeaderboardImageRow[] {
  return page.entries.map((entry) => ({
    rank: entry.rank,
    userId: entry.userId,
    detail: formatWins(entry.wins),
  }));
}

function buildNavigationRow(
  page: LeaderboardWinPage,
  requesterId: string,
): ActionRowBuilder<ButtonBuilder> {
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("first", page.scope, firstPage, requesterId),
      )
      .setLabel("First")
      .setEmoji("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "previous",
          page.scope,
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
        createButtonCustomId("next", page.scope, nextPage, requesterId),
      )
      .setLabel("Next")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page.page === page.totalPages),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "last",
          page.scope,
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

export async function buildWinLeaderboardResponse(
  page: LeaderboardWinPage,
  requesterId: string,
  profiles: ReadonlyMap<string, LeaderboardMemberProfile> = new Map(),
): Promise<InteractionEditReplyOptions> {
  const image = await renderLeaderboardImage({
    rows: createWinLeaderboardImageRows(page),
    profiles,
    emptyMessage: `No completed ${page.scope} leaderboard yet.`,
  });
  const fileName = `yapper-wins-${page.scope}-page-${page.page}.png`;
  const embed = new EmbedBuilder()
    .setColor(yapperColors.blue)
    .setTitle(`${scopeLabels[page.scope]} Leaderboard Wins`)
    .setDescription(`Completed ${page.scope} XP leaderboards • ${page.timezone}`)
    .setImage(`attachment://${fileName}`)
    .setFooter({
      text: `Page ${page.page}/${page.totalPages} • Top ${page.visibleEntryCount} of ${page.participantCount} • Completed periods only`,
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
    scope: LeaderboardRecordScope;
    page: number;
  },
): Promise<LeaderboardWinPage> {
  return context.leaderboardService.getWinPage({ ...input, now: new Date() });
}

export async function handleWinLeaderboardButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): Promise<boolean> {
  const request = parseWinButton(interaction.customId);

  if (!request) {
    return false;
  }

  if (interaction.user.id !== request.requesterId) {
    await interaction.reply({
      content: `Run \`/wins ${request.scope}\` yourself to open controls you can use.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "Wins leaderboards can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferUpdate();
  const page = await loadPage(context, {
    guildId: interaction.guildId,
    scope: request.scope,
    page: request.page,
  });
  const profiles = await resolveLeaderboardProfiles(
    interaction.client,
    page.entries.map((entry) => entry.userId),
  );
  await interaction.editReply(
    await buildWinLeaderboardResponse(
      page,
      request.requesterId,
      profiles,
    ),
  );
  return true;
}

function configureWinSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  scope: LeaderboardRecordScope,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName(scope)
    .setDescription(`Show the most ${scope} XP leaderboard wins.`)
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Optional page from 1 to 10.")
        .setMinValue(1)
        .setMaxValue(10),
    );
}

export const winsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("wins")
    .setDescription("Show completed XP leaderboard wins.")
    .addSubcommand((subcommand) =>
      configureWinSubcommand(subcommand, "weekly"),
    )
    .addSubcommand((subcommand) =>
      configureWinSubcommand(subcommand, "monthly"),
    )
    .addSubcommand((subcommand) =>
      configureWinSubcommand(subcommand, "yearly"),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Wins leaderboards can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const scope = interaction.options.getSubcommand(
      true,
    ) as LeaderboardRecordScope;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      scope,
      page: interaction.options.getInteger("page") ?? 1,
    });
    const profiles = await resolveLeaderboardProfiles(
      interaction.client,
      page.entries.map((entry) => entry.userId),
    );
    await interaction.editReply(
      await buildWinLeaderboardResponse(page, interaction.user.id, profiles),
    );
  },
};
