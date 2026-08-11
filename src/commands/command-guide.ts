import {
  EmbedBuilder,
  SlashCommandBuilder,
  type InteractionReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { yapperColors } from "../presentation/colors.js";

const commandGroups = [
  {
    name: "Level leaderboard",
    commands: "/lb all, /lb weekly, /lb monthly, /lb yearly",
  },
  { name: "XP leaderboard", commands: "/xplb" },
  {
    name: "Activity records",
    commands: "/top weekly, /top monthly, /top yearly",
  },
  {
    name: "Reaction leaderboards",
    commands: "/react received, /react given",
  },
  {
    name: "Emoji leaderboards",
    commands: "/emoji all, /emoji weekly, /emoji monthly, /emoji yearly",
  },
  { name: "Personal progress", commands: "/rank, /xp info" },
  { name: "Level rewards", commands: "/rewards" },
  { name: "Other", commands: "/ping, /cmd, ?g <query>" },
] as const;

export function buildCommandGuideResponse(): InteractionReplyOptions {
  const embed = new EmbedBuilder()
    .setColor(yapperColors.violet)
    .setTitle("Yapper command guide")
    .addFields(
      commandGroups.map((group) => ({
        name: group.name,
        value: group.commands
          .split(", ")
          .map((command) => `\`${command}\``)
          .join(", "),
      })),
    );

  return { embeds: [embed] };
}

export const commandGuideCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("cmd")
    .setDescription("Show Yapper's user command guide."),
  async execute(interaction) {
    await interaction.reply(buildCommandGuideResponse());
  },
};
