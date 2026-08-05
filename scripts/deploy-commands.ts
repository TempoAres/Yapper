import { REST, Routes } from "discord.js";

import { commands } from "../src/commands/index.js";
import { loadBotConfig } from "../src/config/environment.js";

async function deployCommands(): Promise<void> {
  const config = loadBotConfig();
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const destination = config.guildId
    ? `test server ${config.guildId}`
    : "all servers (global deployment)";

  console.log(`Deploying ${body.length} slash command(s) to ${destination}...`);
  await rest.put(route, { body });
  console.log("Slash commands deployed successfully.");
}

deployCommands().catch((error: unknown) => {
  console.error("Slash command deployment failed:", error);
  process.exitCode = 1;
});
