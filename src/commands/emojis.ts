import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type InteractionEditReplyOptions,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import type { BotCommand, CommandContext } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import { formatCalendarDateRange } from "../presentation/date-format.js";
import {
  fetchImageDataUri,
  renderLeaderboardImage,
  resolveLeaderboardProfiles,
  type LeaderboardImageRow,
  type LeaderboardMemberProfile,
} from "../services/leaderboards/leaderboard-image.js";
import type { LeaderboardScope } from "../services/leaderboards/leaderboard-service.js";
import type {
  EmojiLeaderboardMetric,
  EmojiLeaderboardPage,
} from "../services/emoji/emoji-service.js";
import { getTwemojiAssetUrl } from "../services/emoji/twemoji-image.js";

const buttonPrefix = "yapper:emoji";
type EmojiButtonAction =
  | "users"
  | "emojis"
  | "first"
  | "previous"
  | "next"
  | "last";

const scopeLabels: Record<LeaderboardScope, string> = {
  all: "All-time",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function formatCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

function createContextLine(page: EmojiLeaderboardPage): string | null {
  if (!page.periodStart || !page.periodEnd) {
    return null;
  }

  return `${formatCalendarDateRange(page.periodStart, page.periodEnd)} • ${page.timezone}`;
}

function createButtonCustomId(
  action: EmojiButtonAction,
  metric: EmojiLeaderboardMetric,
  scope: LeaderboardScope,
  page: number,
  requesterId: string,
): string {
  return `${buttonPrefix}:${action}:${metric}:${scope}:${page}:${requesterId}`;
}

export interface EmojiButtonRequest {
  action: EmojiButtonAction;
  metric: EmojiLeaderboardMetric;
  scope: LeaderboardScope;
  page: number;
  requesterId: string;
}

export function parseEmojiButton(customId: string): EmojiButtonRequest | null {
  const match = /^yapper:emoji:(users|emojis|first|previous|next|last):(users|emojis):(all|weekly|monthly|yearly):(\d{1,2}):(\d{17,20})$/.exec(
    customId,
  );

  if (!match) {
    return null;
  }

  const page = Number(match[4]);

  if (!Number.isInteger(page) || page < 1 || page > 10) {
    return null;
  }

  return {
    action: match[1] as EmojiButtonAction,
    metric: match[2] as EmojiLeaderboardMetric,
    scope: match[3] as LeaderboardScope,
    page,
    requesterId: match[5] as string,
  };
}

export function createEmojiLeaderboardImageRows(
  page: EmojiLeaderboardPage,
): readonly LeaderboardImageRow[] {
  return page.entries.map((entry) => ({
    rank: entry.rank,
    userId: entry.key,
    detail: formatCount(entry.count),
    namePrefix: page.metric === "emojis" ? "" : "@",
  }));
}

async function resolveEmojiProfiles(
  guild: Guild,
  emojiKeys: readonly string[],
): Promise<ReadonlyMap<string, LeaderboardMemberProfile>> {
  const profiles = await Promise.all(
    [...new Set(emojiKeys)].map(
      async (emojiKey): Promise<LeaderboardMemberProfile> => {
        if (emojiKey.startsWith("unicode:")) {
          const emoji = emojiKey.slice("unicode:".length);
          const assetUrl = getTwemojiAssetUrl(emoji);
          const imageDataUri = assetUrl
            ? await fetchImageDataUri(assetUrl)
            : null;

          return {
            userId: emojiKey,
            displayName: emoji,
            avatarDataUri: imageDataUri,
            ...(imageDataUri
              ? { displayImageDataUri: imageDataUri }
              : { iconText: emoji }),
          };
        }

        const emojiId = emojiKey.slice("custom:".length);
        const emoji = guild.emojis.cache.get(emojiId);

        if (!emoji) {
          return {
            userId: emojiKey,
            displayName: `Deleted emoji ${emojiId.slice(-4)}`,
            avatarDataUri: null,
            iconText: "?",
          };
        }

        return {
          userId: emojiKey,
          displayName: `:${emoji.name ?? "emoji"}:`,
          avatarDataUri: await fetchImageDataUri(
            emoji.imageURL({ extension: "png", size: 128 }),
          ),
        };
      },
    ),
  );

  return new Map(profiles.map((profile) => [profile.userId, profile]));
}

async function resolveProfiles(
  client: Client,
  guild: Guild,
  page: EmojiLeaderboardPage,
): Promise<ReadonlyMap<string, LeaderboardMemberProfile>> {
  const keys = page.entries.map((entry) => entry.key);
  return page.metric === "users"
    ? resolveLeaderboardProfiles(client, keys)
    : resolveEmojiProfiles(guild, keys);
}

function buildViewRow(
  page: EmojiLeaderboardPage,
  requesterId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("users", "users", page.scope, 1, requesterId),
      )
      .setLabel("Top Users")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page.metric === "users"),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("emojis", "emojis", page.scope, 1, requesterId),
      )
      .setLabel("Top Emojis")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page.metric === "emojis"),
  );
}

function buildNavigationRow(
  page: EmojiLeaderboardPage,
  requesterId: string,
): ActionRowBuilder<ButtonBuilder> {
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "first",
          page.metric,
          page.scope,
          firstPage,
          requesterId,
        ),
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
        createButtonCustomId(
          "next",
          page.metric,
          page.scope,
          nextPage,
          requesterId,
        ),
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

export async function buildEmojiLeaderboardResponse(
  page: EmojiLeaderboardPage,
  requesterId: string,
  profiles: ReadonlyMap<string, LeaderboardMemberProfile> = new Map(),
): Promise<InteractionEditReplyOptions> {
  const image = await renderLeaderboardImage({
    rows: createEmojiLeaderboardImageRows(page),
    profiles,
    emptyMessage: "No message emoji usage has been recorded yet.",
  });
  const fileName = `yapper-emoji-${page.metric}-${page.scope}-page-${page.page}.png`;
  const title =
    page.metric === "users"
      ? `${scopeLabels[page.scope]} Emoji Users`
      : `${scopeLabels[page.scope]} Top Emojis`;
  const embed = new EmbedBuilder()
    .setColor(
      page.metric === "users" ? yapperColors.cyan : yapperColors.magenta,
    )
    .setTitle(title)
    .setImage(`attachment://${fileName}`)
    .setFooter({
      text: `Page ${page.page}/${page.totalPages} • Top ${page.visibleEntryCount} of ${page.participantCount}`,
    })
    .setTimestamp(page.generatedAt);
  const contextLine = createContextLine(page);

  if (contextLine) {
    embed.setDescription(contextLine);
  }

  return {
    embeds: [embed],
    components: [
      buildViewRow(page, requesterId),
      buildNavigationRow(page, requesterId),
    ],
    files: [new AttachmentBuilder(image, { name: fileName })],
    attachments: [],
  };
}

async function loadPage(
  context: CommandContext,
  input: {
    guildId: string;
    metric: EmojiLeaderboardMetric;
    scope: LeaderboardScope;
    page: number;
  },
): Promise<EmojiLeaderboardPage> {
  return context.emojiService.getLeaderboardPage({ ...input, now: new Date() });
}

export async function handleEmojiLeaderboardButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): Promise<boolean> {
  const request = parseEmojiButton(interaction.customId);

  if (!request) {
    return false;
  }

  if (interaction.user.id !== request.requesterId) {
    await interaction.reply({
      content: `Run \`/emoji ${request.scope}\` yourself to open controls you can use.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Emoji leaderboards can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferUpdate();
  const page = await loadPage(context, {
    guildId: interaction.guildId,
    metric: request.metric,
    scope: request.scope,
    page: request.page,
  });
  const profiles = await resolveProfiles(
    interaction.client,
    interaction.guild,
    page,
  );
  await interaction.editReply(
    await buildEmojiLeaderboardResponse(page, request.requesterId, profiles),
  );
  return true;
}

function configureScopeSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  scope: LeaderboardScope,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName(scope)
    .setDescription(`Show ${scopeLabels[scope].toLowerCase()} message emoji usage.`)
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Optional page from 1 to 10.")
        .setMinValue(1)
        .setMaxValue(10),
    );
}

export const emojiCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("emoji")
    .setDescription("Show message emoji usage leaderboards.")
    .addSubcommand((subcommand) => configureScopeSubcommand(subcommand, "all"))
    .addSubcommand((subcommand) =>
      configureScopeSubcommand(subcommand, "weekly"),
    )
    .addSubcommand((subcommand) =>
      configureScopeSubcommand(subcommand, "monthly"),
    )
    .addSubcommand((subcommand) =>
      configureScopeSubcommand(subcommand, "yearly"),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "Emoji leaderboards can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const scope = interaction.options.getSubcommand(true) as LeaderboardScope;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      metric: "users",
      scope,
      page: interaction.options.getInteger("page") ?? 1,
    });
    const profiles = await resolveProfiles(
      interaction.client,
      interaction.guild,
      page,
    );
    await interaction.editReply(
      await buildEmojiLeaderboardResponse(page, interaction.user.id, profiles),
    );
  },
};
