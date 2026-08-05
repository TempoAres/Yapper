import {
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { executeProgressCommand } from "./progress.js";
import {
  executeAdminXpCommand,
  type AdminXpSubcommand,
} from "./xp-admin.js";

const addReasonOption = (
  builder: SlashCommandSubcommandBuilder,
): SlashCommandSubcommandBuilder =>
  builder.addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Optional audit reason (maximum 200 characters).")
      .setMaxLength(200),
  );

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
    )
    .addSubcommandGroup((group) =>
      group
        .setName("admin")
        .setDescription("Private moderator XP controls.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("view")
            .setDescription("Privately view a member's exact XP balances.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The member to inspect.")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          addReasonOption(
            subcommand
              .setName("add")
              .setDescription("Add audited Yapper XP to a member.")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("The member to update.")
                  .setRequired(true),
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("Yapper XP to add.")
                  .setMinValue(1)
                  .setMaxValue(1_000_000_000)
                  .setRequired(true),
              ),
          ),
        )
        .addSubcommand((subcommand) =>
          addReasonOption(
            subcommand
              .setName("remove")
              .setDescription("Remove audited Yapper XP from a member.")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("The member to update.")
                  .setRequired(true),
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("Yapper XP to remove without going below zero.")
                  .setMinValue(1)
                  .setMaxValue(1_000_000_000)
                  .setRequired(true),
              ),
          ),
        )
        .addSubcommand((subcommand) =>
          addReasonOption(
            subcommand
              .setName("set")
              .setDescription("Set a member's audited Yapper XP balance.")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("The member to update.")
                  .setRequired(true),
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("The exact new Yapper XP balance.")
                  .setMinValue(0)
                  .setMaxValue(1_000_000_000)
                  .setRequired(true),
              ),
          ),
        ),
    ),

  async execute(interaction, context) {
    const group = interaction.options.getSubcommandGroup(false);

    if (group === "admin") {
      await executeAdminXpCommand(
        interaction,
        context,
        interaction.options.getSubcommand(true) as AdminXpSubcommand,
      );
      return;
    }

    await executeProgressCommand(interaction, context, true);
  },
};
