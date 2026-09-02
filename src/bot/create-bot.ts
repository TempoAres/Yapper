import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from "discord.js";

import { commandsByName } from "../commands/index.js";
import type { CommandContext } from "../commands/command.js";
import { handleLeaderboardButton } from "../commands/leaderboard.js";
import { handleReactionLeaderboardButton } from "../commands/reactions.js";
import { handleEmojiLeaderboardButton } from "../commands/emojis.js";
import { handleWinLeaderboardButton } from "../commands/wins.js";
import type { BotConfig } from "../config/environment.js";
import type { MessageXpTracker } from "../services/xp/message-xp-tracker.js";
import type { ReactionTracker } from "../services/reactions/reaction-tracker.js";
import { registerGoogleSearchListener } from "./google-search-listener.js";
import { registerJournalListener } from "./journal-listener.js";
import { registerMessageXpListener } from "./message-xp-listener.js";
import { registerMessageEmojiListener } from "./message-emoji-listener.js";
import { registerReactionListener } from "./reaction-listener.js";

export async function startBot(
  config: BotConfig,
  context: CommandContext,
  messageXpTracker: MessageXpTracker,
  reactionTracker: ReactionTracker,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  registerMessageXpListener(
    client,
    messageXpTracker,
    context.roleRewardCoordinator,
  );
  registerGoogleSearchListener(client);
  registerMessageEmojiListener(client, context.emojiService);
  if (context.journalConfig.targetUserId) {
    registerJournalListener(
      client,
      context.journalService,
      context.journalConfig.targetUserId,
    );
  }
  registerReactionListener(client, reactionTracker);

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Yapper is online as ${readyClient.user.tag}.`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (await handleEmojiLeaderboardButton(interaction, context)) {
          return;
        }

        if (await handleLeaderboardButton(interaction, context)) {
          return;
        }

        if (await handleWinLeaderboardButton(interaction, context)) {
          return;
        }

        await handleReactionLeaderboardButton(interaction, context);
        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command = commandsByName.get(interaction.commandName);

      if (!command) {
        console.warn(`Received unknown command: /${interaction.commandName}`);
        await interaction.reply({
          content: "I don't recognize that command yet.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await command.execute(interaction, context);
    } catch (error) {
      const interactionLabel = interaction.isChatInputCommand()
        ? `/${interaction.commandName}`
        : interaction.isButton()
          ? interaction.customId
          : interaction.id;
      console.error(`Interaction ${interactionLabel} failed:`, error);

      const response = {
        content: "Something went wrong while handling that interaction.",
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      }
    }
  });

  await client.login(config.token);
  return client;
}
