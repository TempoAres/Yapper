import "dotenv/config";

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string | undefined;
}

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and add the required value.`,
    );
  }

  return value;
}

/**
 * Reads secrets at startup instead of at import time. This keeps tests and
 * future command-line tools from requiring a Discord token unnecessarily.
 */
export function loadBotConfig(): BotConfig {
  return {
    token: readRequiredEnvironmentVariable("DISCORD_TOKEN"),
    clientId: readRequiredEnvironmentVariable("DISCORD_CLIENT_ID"),
    guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  };
}
