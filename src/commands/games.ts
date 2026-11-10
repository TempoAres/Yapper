import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { BotCommand } from "./command.js";
import { gameNames, type GameName } from "../services/games/games.js";

export const gamesCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("games")
    .setDescription("Discover cooperative channel games."),
  async execute(i) {
    await i.reply({
      content:
        "**Cooperative games**\n**wordchain** — build an English word chain; no repeats or consecutive turns.\n**categories** — find unique answers to a curated category in 30 seconds.\n**counting** — take turns counting; multiples of five become “yap”. Mistakes reset the streak.\nStart: `/game X start` • Stop: `/game X stop`\nOne game per channel; different channels play independently. Channel records survive restarts; active rounds end on restart. Only the starter or Manage Channels members can stop a game.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
export const gameCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("game")
    .setDescription("Start or stop a cooperative channel game.")
    .addSubcommandGroup((g) =>
      g
        .setName("wordchain")
        .setDescription("English word chain")
        .addSubcommand((s) =>
          s.setName("start").setDescription("Start word chain"),
        )
        .addSubcommand((s) =>
          s.setName("stop").setDescription("Stop word chain"),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName("categories")
        .setDescription("Category rush")
        .addSubcommand((s) =>
          s.setName("start").setDescription("Start category rush"),
        )
        .addSubcommand((s) =>
          s.setName("stop").setDescription("Stop category rush"),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName("counting")
        .setDescription("Counting with twists")
        .addSubcommand((s) =>
          s.setName("start").setDescription("Start counting"),
        )
        .addSubcommand((s) =>
          s.setName("stop").setDescription("Stop counting"),
        ),
    ),
  async execute(i, context) {
    const games = context.games;
    if (!i.inGuild() || !games || !i.channel || !i.channel.isSendable()) {
      await i.reply({
        content: "Games are available in server text channels.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const permissions = i.guild?.members.me?.permissionsIn(i.channelId);
    if (
      !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        i.channel.isThread()
          ? PermissionFlagsBits.SendMessagesInThreads
          : PermissionFlagsBits.SendMessages,
      ])
    ) {
      await i.reply({
        content: "I need permission to view and send messages in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const game = i.options.getSubcommandGroup(true) as GameName;
    if (!gameNames.includes(game)) return;
    const starting = i.options.getSubcommand() === "start";
    await i.deferReply();
    const text = starting
      ? games.start(i.channelId, game, i.user.id)
      : games.stop(
          i.channelId,
          game,
          i.user.id,
          i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false,
        );
    await i.editReply({
      content: `${text}\nChannel record for ${game}: **${games.best(i.channelId, game)}**.`,
      allowedMentions: { parse: [] },
    });
  },
};
