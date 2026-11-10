import { formatHigherLowerLeaderboard } from "../services/games/higherlower-wins.js";
import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { BotCommand } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import { categories, gameNames, type GameName } from "../services/games/games.js";

export const gamesCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("games")
    .setDefaultMemberPermissions(null)
    .setDescription("Discover cooperative channel games."),
  async execute(i) {
    await i.deferReply();
    const themes = [];
    for (let index = 0; index < categories.length; index += 3)
      themes.push(categories.slice(index, index + 3).map(category => category.name).join(" · "));
    await i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(yapperColors.violet)
          .setTitle("🎮 Yapper games")
          .setDescription("**Pick a game. Play together. Build a shared score.**\nAnyone can start a round — just choose a command below.")
          .addFields(
            {
              name: "🔗 Word chain",
              value: "`/game wordchain start`\nStart from **apple**. Each English word begins with the last letter of the previous accepted word. Take turns; no repeats.\n✅ Accepted · ❌ Invalid · 🔁 Already used · ⏳ Wait your turn\n**Score:** `/score` · Automatic updates every **100 words**",
            },
            {
              name: "🎯 Category rush · 60 seconds",
              value: "`/game categories start`\nFind as many different answers as you can for a theme. Automatic picks cycle through every category before repeating. Choose your own with `category:`. **One answer per message**, including names with spaces like **Wither skeleton**.\n✅ Accepted · 🔁 Already counted",
            },
            {
              name: "🔢 Counting",
              value: "`/game counting start`\nTake turns counting from **1**. Replace every multiple of **5** with **yap**.\n✅ Correct · ❌ Mistake or consecutive turn — start again at **1**",
            },
            {
              name: "↕️ Higher / lower",
              value: "`/game higherlower start`\nGuess the secret number from **1–10,000**. Consecutive guesses are welcome.\n⬆️ Guess higher · ⬇️ Guess lower · ✅ Solved!\n**Wins:** `/game higherlower leaderboard`",
            },
            { name: `📚 ${categories.length} category themes`, value: themes.join("\n") },
            {
              name: "Playing & stopping",
              value: "**One game per channel.** Anyone can stop it: replace `start` with `stop` in its command.\nTurn feedback uses reactions, with word-chain updates every **100 words** and a final result when the game ends.\nWord chain, counting and higher/lower end after **30 minutes without a valid turn**. Active rounds end when the bot restarts.",
            },
          )
          .setFooter({ text: "Shared scores · Channel records survive restarts" }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};
export const gameCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("game")
    .setDefaultMemberPermissions(null)
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
          s.setName("start").setDescription("Start category rush")
            .addStringOption(option => option
              .setName("category")
              .setDescription("Choose a theme, or leave blank to rotate through all categories")
              .setRequired(false)
              .addChoices(...categories.map(category => ({ name: category.name, value: category.name })))),
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
    )
    .addSubcommandGroup((g) =>
      g
        .setName("higherlower")
        .setDescription("Guess a secret number from 1 to 10,000")
        .addSubcommand((s) =>
          s.setName("start").setDescription("Start higher/lower"),
        )
        .addSubcommand((s) =>
          s.setName("stop").setDescription("Stop higher/lower"),
        )
        .addSubcommand((s) =>
          s.setName("leaderboard").setDescription("Show completed games and channel wins"),
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
    if (game === "higherlower" && i.options.getSubcommand() === "leaderboard") {
      if (!context.higherLowerWins) {
        await i.reply({ content: "The wins leaderboard is unavailable.", flags: MessageFlags.Ephemeral });
        return;
      }
      await i.deferReply();
      await i.editReply({
        content: formatHigherLowerLeaderboard(await context.higherLowerWins.leaderboard(i.guildId!)),
        allowedMentions: { parse: [] },
      });
      return;
    }
    const starting = i.options.getSubcommand() === "start";
    if (
      starting &&
      !permissions.has([
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ReadMessageHistory,
      ])
    ) {
      await i.reply({
        content: "I need Add Reactions and Read Message History permissions for channel games.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.deferReply();
    const text = starting
      ? games.start(i.channelId, game, i.user.id, Date.now(), game === "categories" ? i.options.getString("category") ?? undefined : undefined)
      : games.stop(i.channelId, game);
    await i.editReply({
      content:
        game === "higherlower"
          ? text
          : `${text}\nChannel record for ${game}: **${games.best(i.channelId, game)}**.`,
      allowedMentions: { parse: [] },
    });
  },
};
