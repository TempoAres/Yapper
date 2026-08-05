import "dotenv/config";

import { readFileSync } from "node:fs";

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string | undefined;
}

export type DatabaseConfig =
  | { connectionString: string }
  | {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    };

export interface HealthConfig {
  port: number | undefined;
}

export interface MessageXpConfig {
  minimumXp: number;
  maximumXp: number;
  cooldownMilliseconds: number;
  duplicateWindowMilliseconds: number;
}

export interface LeaderboardConfig {
  defaultTimezone: string;
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

function readOptionalSecret(name: string): string | undefined {
  const directValue = process.env[name]?.trim();
  const filePath = process.env[`${name}_FILE`]?.trim();

  if (directValue && filePath) {
    throw new Error(`Set either ${name} or ${name}_FILE, not both.`);
  }

  if (directValue) {
    return directValue;
  }

  if (!filePath) {
    return undefined;
  }

  try {
    const fileValue = readFileSync(filePath, "utf8").trim();

    if (!fileValue) {
      throw new Error("the file is empty");
    }

    return fileValue;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${name}_FILE at ${filePath}: ${reason}`);
  }
}

function readRequiredSecret(name: string): string {
  const value = readOptionalSecret(name);

  if (!value) {
    throw new Error(
      `Missing ${name}. Set ${name} directly or point ${name}_FILE at a secret file.`,
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
    token: readRequiredSecret("DISCORD_TOKEN"),
    clientId: readRequiredEnvironmentVariable("DISCORD_CLIENT_ID"),
    guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  };
}

export function loadDatabaseConfig(): DatabaseConfig {
  const connectionString = readOptionalSecret("DATABASE_URL");

  if (connectionString) {
    return { connectionString };
  }

  return {
    host: readRequiredEnvironmentVariable("DATABASE_HOST"),
    port: readPositiveInteger("DATABASE_PORT", 5432),
    database: readRequiredEnvironmentVariable("DATABASE_NAME"),
    user: readRequiredEnvironmentVariable("DATABASE_USER"),
    password: readRequiredSecret("DATABASE_PASSWORD"),
  };
}

export function loadHealthConfig(): HealthConfig {
  const rawPort = process.env.HEALTH_PORT?.trim();

  if (!rawPort) {
    return { port: undefined };
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("HEALTH_PORT must be a whole number from 1 to 65535.");
  }

  return { port };
}

export function loadMessageXpConfig(): MessageXpConfig {
  const minimumXp = readPositiveInteger("XP_MIN_PER_MESSAGE", 15);
  const maximumXp = readPositiveInteger("XP_MAX_PER_MESSAGE", 40);

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

export function loadLeaderboardConfig(): LeaderboardConfig {
  const defaultTimezone = process.env.TIMEZONE?.trim() || "Europe/Berlin";

  try {
    new Intl.DateTimeFormat("en", { timeZone: defaultTimezone }).format();
  } catch {
    throw new Error(`TIMEZONE must be a valid IANA timezone, such as Europe/Berlin.`);
  }

  return { defaultTimezone };
}
