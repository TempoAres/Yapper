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
import {
  renderLeaderboardImage,
  resolveLeaderboardProfiles,
  type LeaderboardImageRow,
  type LeaderboardMemberProfile,
} from "../services/leaderboards/leaderboard-image.js";
import type {
  LeaderboardDisplay,
  LeaderboardPage,
  LeaderboardRecordScope,
  LeaderboardScope,
} from "../services/leaderboards/leaderboard-service.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";

const buttonPrefix = "yapper:lb";
type LeaderboardButtonAction = "first" | "previous" | "next" | "last";
type LeaderboardView = LeaderboardDisplay | "record";

const scopeLabels: Record<LeaderboardScope, string> = {
  all: "All-time",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const scopeNouns: Record<LeaderboardRecordScope, string> = {
  weekly: "week",
  monthly: "month",
  yearly: "year",
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

function formatDateRange(start: string, end: string): string {
  const formattedStart = formatIsoDate(start);
  const formattedEnd = formatIsoDate(end);
  return formattedStart === formattedEnd
    ? formattedStart
    : `${formattedStart} – ${formattedEnd}`;
}

function createContextLine(page: LeaderboardPage): string | null {
  if (
    page.kind === "record" ||
    page.scope === "all" ||
    !page.periodStart ||
    !page.periodEnd
  ) {
    return null;
  }

  const launchNote = page.launchLimited
    ? " • First period begins when Yapper tracking started"
    : "";
  return `${formatDateRange(page.periodStart, page.periodEnd)} • ${page.timezone}${launchNote}`;
}

export function createLeaderboardImageRows(
  page: LeaderboardPage,
  view: LeaderboardView,
): readonly LeaderboardImageRow[] {
  return page.entries.map((entry) => {
    if (view === "record") {
      if (!entry.recordStart || !entry.recordEnd) {
        throw new Error("A record leaderboard entry has no date range.");
      }

      return {
        rank: entry.rank,
        userId: entry.userId,
        detail: `${formatXp(entry.xp)} XP • ${formatDateRange(entry.recordStart, entry.recordEnd)}`,
      };
    }

    const progress = calculateLevelProgress(entry.allTimeXp);

    if (view === "xp") {
      if (page.scope === "all") {
        return {
          rank: entry.rank,
          userId: entry.userId,
          detail: `LVL: ${progress.level} XP: ${formatXp(entry.xp)}`,
        };
      }

      const startingXp = Math.max(0, entry.allTimeXp - entry.xp);
      const startingLevel = calculateLevelProgress(startingXp).level;
      return {
        rank: entry.rank,
        userId: entry.userId,
        detail: `LVL: +${Math.max(0, progress.level - startingLevel)} XP: +${formatXp(entry.xp)}`,
      };
    }

    return {
      rank: entry.rank,
      userId: entry.userId,
      detail: `LVL: ${progress.level}`,
      progress: progress.progress,
    };
  });
}

function createButtonCustomId(
  action: LeaderboardButtonAction,
  view: LeaderboardView,
  scope: LeaderboardScope,
  page: number,
  requesterId: string,
): string {
  return `${buttonPrefix}:${action}:${view}:${scope}:${page}:${requesterId}`;
}

export interface LeaderboardButtonRequest {
  action: LeaderboardButtonAction;
  view: LeaderboardView;
  scope: LeaderboardScope;
  page: number;
  requesterId: string;
}

export function parseLeaderboardButton(
  customId: string,
): LeaderboardButtonRequest | null {
  const currentMatch = /^yapper:lb:(first|previous|next|last):(level|xp|record):(all|weekly|monthly|yearly):(\d{1,2}):(\d{17,20})$/.exec(
    customId,
  );
  const legacyMatch = /^yapper:leaderboard:(first|previous|next|last):(all|weekly|monthly|yearly):(\d{1,2}):(\d{17,20})$/.exec(
    customId,
  );

  const action = currentMatch?.[1] ?? legacyMatch?.[1];
  const view = currentMatch?.[2] ?? "xp";
  const scope = currentMatch?.[3] ?? legacyMatch?.[2];
  const rawPage = currentMatch?.[4] ?? legacyMatch?.[3];
  const requesterId = currentMatch?.[5] ?? legacyMatch?.[4];

  if (!action || !scope || !rawPage || !requesterId) {
    return null;
  }

  const page = Number(rawPage);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10 ||
    (view === "record" && scope === "all")
  ) {
    return null;
  }

  return {
    action: action as LeaderboardButtonAction,
    view: view as LeaderboardView,
    scope: scope as LeaderboardScope,
    page,
    requesterId,
  };
}

function buildNavigationRow(
  page: LeaderboardPage,
  requesterId: string,
  view: LeaderboardView,
): ActionRowBuilder<ButtonBuilder> {
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId("first", view, page.scope, firstPage, requesterId),
      )
      .setLabel("First")
      .setEmoji("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page.page === firstPage),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "previous",
          view,
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
        createButtonCustomId("next", view, page.scope, nextPage, requesterId),
      )
      .setLabel("Next")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page.page === page.totalPages),
    new ButtonBuilder()
      .setCustomId(
        createButtonCustomId(
          "last",
          view,
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

export async function buildLeaderboardResponse(
  page: LeaderboardPage,
  requesterId: string,
  view: LeaderboardView = "level",
  profiles: ReadonlyMap<string, LeaderboardMemberProfile> = new Map(),
): Promise<InteractionEditReplyOptions> {
  const rows = createLeaderboardImageRows(page, view);
  const image = await renderLeaderboardImage({
    rows,
    profiles,
    emptyMessage:
      view === "record"
        ? "No activity records have been recorded yet."
        : "No activity has been recorded for this leaderboard yet.",
  });
  const fileName = `yapper-${view}-${page.scope}-page-${page.page}.png`;
  const title =
    view === "record"
      ? `${scopeLabels[page.scope]} Activity Records`
      : `${scopeLabels[page.scope]} ${view === "level" ? "Level" : "XP"} Leaderboard`;
  const embed = new EmbedBuilder()
    .setColor(view === "record" ? 0xed4245 : view === "xp" ? 0x57f287 : 0x2ec7c9)
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
    components: [buildNavigationRow(page, requesterId, view)],
    files: [new AttachmentBuilder(image, { name: fileName })],
    attachments: [],
  };
}

async function loadPage(
  context: CommandContext,
  input: {
    guildId: string;
    view: LeaderboardView;
    scope: LeaderboardScope;
    page: number;
  },
): Promise<LeaderboardPage> {
  if (input.view === "record") {
    return context.leaderboardService.getRecordPage({
      guildId: input.guildId,
      scope: input.scope as LeaderboardRecordScope,
      page: input.page,
      now: new Date(),
    });
  }

  return context.leaderboardService.getPage({
    guildId: input.guildId,
    scope: input.scope,
    page: input.page,
    now: new Date(),
  });
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
      content: "Run `/lb` yourself to open controls you can use.",
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
  const page = await loadPage(context, {
    guildId: interaction.guildId,
    view: request.view,
    scope: request.scope,
    page: request.page,
  });
  const profiles = await resolveLeaderboardProfiles(
    interaction.client,
    page.entries.map((entry) => entry.userId),
  );
  await interaction.editReply(
    await buildLeaderboardResponse(
      page,
      request.requesterId,
      request.view,
      profiles,
    ),
  );
  return true;
}

function configureRecordSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  scope: LeaderboardRecordScope,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName(scope)
    .setDescription(`Show each member's best ${scopeNouns[scope]} ever.`)
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Optional page from 1 to 10.")
        .setMinValue(1)
        .setMaxValue(10),
    );
}

export const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("lb")
    .setDescription("Show the server leaderboard. All-time levels are the default.")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("Optionally show this week, month, or year.")
        .addChoices(
          { name: "Weekly", value: "weekly" },
          { name: "Monthly", value: "monthly" },
          { name: "Yearly", value: "yearly" },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("xp")
        .setDescription("Show exact XP instead of level progress."),
    )
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Optional page from 1 to 10.")
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
    const view: LeaderboardDisplay = interaction.options.getBoolean("xp")
      ? "xp"
      : "level";
    const scope = (interaction.options.getString("period") ??
      "all") as LeaderboardScope;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      view,
      scope,
      page: interaction.options.getInteger("page") ?? 1,
    });
    const profiles = await resolveLeaderboardProfiles(
      interaction.client,
      page.entries.map((entry) => entry.userId),
    );

    await interaction.editReply(
      await buildLeaderboardResponse(page, interaction.user.id, view, profiles),
    );
  },
};

export const topCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Show the highest historical activity records.")
    .addSubcommand((subcommand) =>
      configureRecordSubcommand(subcommand, "weekly"),
    )
    .addSubcommand((subcommand) =>
      configureRecordSubcommand(subcommand, "monthly"),
    )
    .addSubcommand((subcommand) =>
      configureRecordSubcommand(subcommand, "yearly"),
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
    const scope = interaction.options.getSubcommand(
      true,
    ) as LeaderboardRecordScope;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      view: "record",
      scope,
      page: interaction.options.getInteger("page") ?? 1,
    });
    const profiles = await resolveLeaderboardProfiles(
      interaction.client,
      page.entries.map((entry) => entry.userId),
    );

    await interaction.editReply(
      await buildLeaderboardResponse(
        page,
        interaction.user.id,
        "record",
        profiles,
      ),
    );
  },
};
