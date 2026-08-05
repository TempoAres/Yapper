import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";

import { commandsByName } from "../commands/index.js";
import type { CommandContext } from "../commands/command.js";
import type { BotConfig } from "../config/environment.js";

export async function startBot(
  config: BotConfig,
  context: CommandContext,
): Promise<Client> {
  // Phase 1 only needs Guilds. Message XP will add the appropriate message
  // intents deliberately in Phase 3, once its privacy rules are implemented.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Yapper is online as ${readyClient.user.tag}.`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
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

    try {
      await command.execute(interaction, context);
    } catch (error) {
      console.error(`Command /${interaction.commandName} failed:`, error);

      const response = {
        content: "Something went wrong while running that command.",
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });

  await client.login(config.token);
  return client;
}
