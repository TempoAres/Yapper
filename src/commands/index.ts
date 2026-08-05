import type { BotCommand } from "./command.js";
import { leaderboardCommand } from "./leaderboard.js";
import { levelCommand } from "./level.js";
import { pingCommand } from "./ping.js";
import { rankCommand } from "./rank.js";
import { xpCommand } from "./xp.js";

export const commands: readonly BotCommand[] = [
  pingCommand,
  leaderboardCommand,
  rankCommand,
  levelCommand,
  xpCommand,
];

export const commandsByName = new Map(
  commands.map((command) => [command.data.name, command] as const),
);
