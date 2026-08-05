import { startBot } from "./bot/create-bot.js";
import { loadBotConfig } from "./config/environment.js";

async function main(): Promise<void> {
  const config = loadBotConfig();
  const client = await startBot(config);

  const shutDown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal}; shutting Yapper down.`);
    client.destroy();
  };

  process.once("SIGINT", () => void shutDown("SIGINT"));
  process.once("SIGTERM", () => void shutDown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Yapper could not start:", error);
  process.exitCode = 1;
});
