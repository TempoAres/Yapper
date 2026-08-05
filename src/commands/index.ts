import type { BotCommand } from "./command.js";
import { pingCommand } from "./ping.js";

export const commands: readonly BotCommand[] = [pingCommand];

export const commandsByName = new Map(
  commands.map((command) => [command.data.name, command] as const),
);
