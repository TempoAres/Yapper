import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "./command.js";

export const scoreCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("score")
    .setDescription("Check this channel's current word-chain score.")
    .setDefaultMemberPermissions(null),
  async execute(interaction, context) {
    const score = interaction.inGuild()
      ? context.games?.wordchainScore(interaction.channelId)
      : undefined;
    await interaction.reply({
      content: !interaction.inGuild()
        ? "Word-chain scores are available in server channels."
        : score === undefined
          ? "No word chain is running in this channel. Start one with `/game wordchain start`."
          : `🔗 Current word-chain score: **${score}**.`,
      allowedMentions: { parse: [] },
    });
  },
};
