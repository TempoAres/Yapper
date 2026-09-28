import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import {
  MAX_GLOSSARY_ABBREVIATION_LENGTH,
  MAX_GLOSSARY_DEFINITION_LENGTH,
  normalizeGlossaryAbbreviation,
  type GlossaryEntry,
} from "../services/glossary/glossary-service.js";

const MAX_LIST_DESCRIPTION_LENGTH = 3_800;
const MAX_LIST_EMBEDS = 10;

function isAdministrator(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

function splitAbbreviations(
  abbreviations: readonly string[],
): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const abbreviation of abbreviations) {
    const line = `\`${abbreviation}\``;
    const addedLength = line.length + (current.length > 0 ? 1 : 0);

    if (
      current.length > 0 &&
      currentLength + addedLength > MAX_LIST_DESCRIPTION_LENGTH
    ) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(line);
    currentLength += line.length + (current.length > 1 ? 1 : 0);
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.slice(0, MAX_LIST_EMBEDS);
}

export function buildGlossaryListResponse(
  abbreviations: readonly string[],
): InteractionEditReplyOptions {
  if (abbreviations.length === 0) {
    return { content: "No glossary abbreviations have been added yet." };
  }

  const chunks = splitAbbreviations(abbreviations);
  const visibleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const embeds = chunks.map((chunk, index) =>
    new EmbedBuilder()
      .setColor(yapperColors.violet)
      .setTitle(
        chunks.length === 1
          ? "Glossary abbreviations"
          : `Glossary abbreviations • ${index + 1}/${chunks.length}`,
      )
      .setDescription(chunk.join("\n"))
      .setFooter({
        text:
          visibleCount === abbreviations.length
            ? `${abbreviations.length.toLocaleString("en-US")} saved`
            : `Showing ${visibleCount.toLocaleString("en-US")} of ${abbreviations.length.toLocaleString("en-US")}`,
      }),
  );

  return { embeds, allowedMentions: { parse: [] } };
}

export function buildGlossaryLookupResponse(
  entry: GlossaryEntry,
): InteractionReplyOptions {
  return {
    content: entry.definition,
    allowedMentions: { parse: [] },
  };
}

export const glossaryCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("glossary")
    .setDescription("Administrate this server's glossary.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add or update a glossary definition.")
        .addStringOption((option) =>
          option
            .setName("abbreviation")
            .setDescription("Short term, such as MS.")
            .setMinLength(1)
            .setMaxLength(MAX_GLOSSARY_ABBREVIATION_LENGTH)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("definition")
            .setDescription("Meaning shown when someone uses /g.")
            .setMinLength(1)
            .setMaxLength(MAX_GLOSSARY_DEFINITION_LENGTH)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List every saved abbreviation without definitions."),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId || !isAdministrator(interaction)) {
      await interaction.reply({
        content: "This command is restricted to server administrators.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "list") {
      const abbreviations = await context.glossaryService.listAbbreviations(
        interaction.guildId,
      );
      await interaction.editReply(buildGlossaryListResponse(abbreviations));
      return;
    }

    const abbreviationInput = interaction.options.getString(
      "abbreviation",
      true,
    );
    const definition = interaction.options.getString("definition", true);

    try {
      const entry = await context.glossaryService.saveEntry({
        guildId: interaction.guildId,
        abbreviation: abbreviationInput,
        definition,
        actorId: interaction.user.id,
      });
      await interaction.editReply({
        content: `Saved glossary entry **${entry.abbreviation}** → ${entry.definition}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (error instanceof RangeError) {
        await interaction.editReply(error.message);
        return;
      }

      throw error;
    }
  },
};

export const glossaryLookupCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("g")
    .setDescription("Look up one server glossary abbreviation.")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("abbreviation")
        .setDescription("Abbreviation to look up, such as MS.")
        .setMinLength(1)
        .setMaxLength(MAX_GLOSSARY_ABBREVIATION_LENGTH)
        .setRequired(true),
    ),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Glossary entries can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const abbreviationInput = interaction.options.getString(
      "abbreviation",
      true,
    );
    let abbreviation: string;

    try {
      abbreviation = normalizeGlossaryAbbreviation(abbreviationInput);
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof RangeError
            ? error.message
            : "That glossary abbreviation is invalid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const entry = await context.glossaryService.getEntry(
      interaction.guildId,
      abbreviation,
    );

    if (!entry) {
      await interaction.reply({
        content: `No glossary definition is configured for **${abbreviation}**.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.reply(buildGlossaryLookupResponse(entry));
  },
};
