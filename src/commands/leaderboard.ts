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
  type SlashCommandSubcommandGroupBuilder,
} from "discord.js";

import type { BotCommand, CommandContext } from "./command.js";
import type {
  LeaderboardDisplay,
  LeaderboardPage,
  LeaderboardRecordScope,
  LeaderboardScope,
} from "../services/leaderboards/leaderboard-service.js";
import { calculateLevelProgress } from "../services/xp/level-curve.js";
import { buildProgressBar } from "../services/xp/progress-bar.js";

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

const medalForRank = (rank: number): string =>
  ({ 1: "🥇", 2: "🥈", 3: "🥉" })[rank] ?? `**#${rank}**`;

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

function createDescription(page: LeaderboardPage, view: LeaderboardView): string {
  if (page.kind === "record") {
    const scope = page.scope as LeaderboardRecordScope;
    return `Each member's highest single ${scopeNouns[scope]} since Yapper tracking began.`;
  }

  if (page.scope === "all") {
    return view === "level"
      ? "Server level standings with progress toward each member's next level."
      : "Total XP earned across the complete server leaderboard.";
  }

  if (!page.periodStart || !page.periodEnd) {
    throw new Error(`The ${page.scope} leaderboard has no date range.`);
  }

  const range = formatDateRange(page.periodStart, page.periodEnd);
  const displayNote =
    view === "level"
      ? "Ranked by activity; showing current level progress."
      : "Showing XP earned during this period.";
  const launchNote = page.launchLimited
    ? " This first period begins when Yapper tracking started."
    : "";

  return `${range} • ${page.timezone}\n${displayNote}${launchNote}`;
}

function createEntryLine(
  page: LeaderboardPage,
  entry: LeaderboardPage["entries"][number],
  view: LeaderboardView,
): string {
  const prefix = `${medalForRank(entry.rank)} <@${entry.userId}>`;

  if (view === "record") {
    if (!entry.recordStart || !entry.recordEnd) {
      throw new Error("A record leaderboard entry has no date range.");
    }

    return `${prefix} • **${formatXp(entry.xp)} XP**\n> ${formatDateRange(entry.recordStart, entry.recordEnd)}`;
  }

  if (view === "xp") {
    return `${prefix} • **${formatXp(entry.xp)} XP**`;
  }

  const progress = calculateLevelProgress(entry.allTimeXp);
  const percentage = Math.floor(progress.progress * 100);
  const progressBar = buildProgressBar(progress.progress, 8);
  return `${prefix}\n> Level **${progress.level}** • ${progressBar} **${percentage}%** to ${progress.level + 1}`;
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

export function buildLeaderboardResponse(
  page: LeaderboardPage,
  requesterId: string,
  view: LeaderboardView = "level",
): InteractionEditReplyOptions {
  const lines = page.entries.map((entry) => createEntryLine(page, entry, view));
  const title =
    view === "record"
      ? `${scopeLabels[page.scope]} activity records`
      : `${scopeLabels[page.scope]} ${view === "level" ? "level" : "XP"} leaderboard`;
  const embed = new EmbedBuilder()
    .setColor(view === "record" ? 0xed4245 : view === "xp" ? 0x57f287 : 0x5865f2)
    .setTitle(title)
    .setDescription(createDescription(page, view))
    .addFields({
      name:
        page.visibleEntryCount === 0
          ? "Standings"
          : `Ranks ${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.visibleEntryCount)}`,
      value:
        lines.length > 0
          ? lines.join("\n")
          : view === "record"
            ? "No activity records have been recorded yet."
            : "No activity has been recorded for this leaderboard yet.",
    })
    .setFooter({
      text: `Page ${page.page}/${page.totalPages} • Top ${page.visibleEntryCount} of ${page.participantCount}`,
    })
    .setTimestamp(page.generatedAt);
  const firstPage = 1;
  const previousPage = Math.max(firstPage, page.page - 1);
  const nextPage = Math.min(page.totalPages, page.page + 1);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
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

  return { embeds: [embed], components: [row] };
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
      content: "Run `/lb all` yourself to open controls you can use.",
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
  await interaction.editReply(
    buildLeaderboardResponse(page, request.requesterId, request.view),
  );
  return true;
}

const scopeDescriptions: Record<LeaderboardScope, string> = {
  all: "Show the all-time leaderboard.",
  weekly: "Show this week's leaderboard.",
  monthly: "Show this month's leaderboard.",
  yearly: "Show this year's leaderboard.",
};

function configurePeriodSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  scope: LeaderboardScope,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName(scope)
    .setDescription(scopeDescriptions[scope])
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Optional page from 1 to 10.")
        .setMinValue(1)
        .setMaxValue(10),
    );
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

function addXpPeriodSubcommands(
  group: SlashCommandSubcommandGroupBuilder,
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName("xp")
    .setDescription("Show exact XP instead of level progress.")
    .addSubcommand((subcommand) => configurePeriodSubcommand(subcommand, "all"))
    .addSubcommand((subcommand) =>
      configurePeriodSubcommand(subcommand, "weekly"),
    )
    .addSubcommand((subcommand) =>
      configurePeriodSubcommand(subcommand, "monthly"),
    )
    .addSubcommand((subcommand) =>
      configurePeriodSubcommand(subcommand, "yearly"),
    );
}

export const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("lb")
    .setDescription("Show level progress or exact XP leaderboards.")
    .addSubcommand((subcommand) => configurePeriodSubcommand(subcommand, "all"))
    .addSubcommand((subcommand) =>
      configurePeriodSubcommand(subcommand, "weekly"),
    )
    .addSubcommand((subcommand) =>
      configurePeriodSubcommand(subcommand, "monthly"),
    )
    .addSubcommand((subcommand) =>
      configurePeriodSubcommand(subcommand, "yearly"),
    )
    .addSubcommandGroup(addXpPeriodSubcommands),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Leaderboards can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const view: LeaderboardDisplay =
      interaction.options.getSubcommandGroup(false) === "xp" ? "xp" : "level";
    const scope = interaction.options.getSubcommand(true) as LeaderboardScope;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      view,
      scope,
      page: interaction.options.getInteger("page") ?? 1,
    });

    await interaction.editReply(
      buildLeaderboardResponse(page, interaction.user.id, view),
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
    const scope = interaction.options.getSubcommand(true) as LeaderboardRecordScope;
    const page = await loadPage(context, {
      guildId: interaction.guildId,
      view: "record",
      scope,
      page: interaction.options.getInteger("page") ?? 1,
    });

    await interaction.editReply(
      buildLeaderboardResponse(page, interaction.user.id, "record"),
    );
  },
};
