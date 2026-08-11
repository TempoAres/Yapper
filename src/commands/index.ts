import type { BotCommand } from "./command.js";
import { leaderboardCommand, topCommand } from "./leaderboard.js";
import { pingCommand } from "./ping.js";
import { rankCommand } from "./rank.js";
import { reactionCommand } from "./reactions.js";
import { recentCommand } from "./recent.js";
import { rewardsCommand } from "./rewards.js";
import { xpCommand } from "./xp.js";

export const commands: readonly BotCommand[] = [
  pingCommand,
  leaderboardCommand,
  topCommand,
  recentCommand,
  rankCommand,
  reactionCommand,
  rewardsCommand,
  xpCommand,
];

export const commandsByName = new Map(
  commands.map((command) => [command.data.name, command] as const),
);
