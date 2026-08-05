import "dotenv/config";

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string | undefined;
}

export interface DatabaseConfig {
  connectionString: string;
}

export interface MessageXpConfig {
  minimumXp: number;
  maximumXp: number;
  cooldownMilliseconds: number;
  duplicateWindowMilliseconds: number;
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

function readPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number.`);
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

export function loadDatabaseConfig(): DatabaseConfig {
  return {
    connectionString: readRequiredEnvironmentVariable("DATABASE_URL"),
  };
}

export function loadMessageXpConfig(): MessageXpConfig {
  const minimumXp = readPositiveInteger("XP_MIN_PER_MESSAGE", 20);
  const maximumXp = readPositiveInteger("XP_MAX_PER_MESSAGE", 30);

  if (maximumXp < minimumXp) {
    throw new Error("XP_MAX_PER_MESSAGE must be at least XP_MIN_PER_MESSAGE.");
  }

  return {
    minimumXp,
    maximumXp,
    cooldownMilliseconds:
      readPositiveInteger("XP_COOLDOWN_SECONDS", 30) * 1_000,
    duplicateWindowMilliseconds:
      readPositiveInteger("XP_DUPLICATE_WINDOW_SECONDS", 120) * 1_000,
  };
}
