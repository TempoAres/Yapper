import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "./command.js";
import { executeProgressCommand } from "./progress.js";

export const rankCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show a member's Yapper rank and level progress.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The member to view; defaults to you."),
    ),

  async execute(interaction, context) {
    await executeProgressCommand(interaction, context);
  },
};
