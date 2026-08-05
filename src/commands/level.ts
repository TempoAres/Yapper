import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "./command.js";
import { executeProgressCommand } from "./progress.js";

export const levelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show a member's Yapper level and rank.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The member to view; defaults to you."),
    ),

  async execute(interaction, context) {
    await executeProgressCommand(interaction, context);
  },
};
