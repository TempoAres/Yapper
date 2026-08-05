import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "./command.js";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether Yapper is online."),

  async execute(interaction) {
    await interaction.reply("Yap.");
  },
};
