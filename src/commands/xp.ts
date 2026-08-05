import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "./command.js";
import { executeProgressCommand } from "./progress.js";

export const xpCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("xp")
    .setDescription("View Yapper XP information.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("info")
        .setDescription("Explain a member's XP and level progression.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to view; defaults to you."),
        ),
    ),

  async execute(interaction, context) {
    await executeProgressCommand(interaction, context, true);
  },
};
