import type { BotCommand } from "./command.js";
import { commandGuideCommand } from "./command-guide.js";
import { emojiCommand } from "./emojis.js";
import { journalCommand } from "./journal.js";
import {
  leaderboardCommand,
  topCommand,
  xpLeaderboardCommand,
} from "./leaderboard.js";
import { pingCommand } from "./ping.js";
import { rankCommand } from "./rank.js";
import { reactionCommand } from "./reactions.js";
import { recentCommand } from "./recent.js";
import { reminderCommand } from "./reminder.js";
import { resetCommand } from "./reset.js";
import { rewardsCommand } from "./rewards.js";
import { timestampCommand } from "./timestamp.js";
import { winsCommand } from "./wins.js";
import { xpCommand } from "./xp.js";

export const commands: readonly BotCommand[] = [
  pingCommand,
  commandGuideCommand,
  emojiCommand,
  journalCommand,
  leaderboardCommand,
  xpLeaderboardCommand,
  topCommand,
  recentCommand,
  rankCommand,
  reactionCommand,
  reminderCommand,
  resetCommand,
  rewardsCommand,
  timestampCommand,
  winsCommand,
  xpCommand,
];

export const commandsByName = new Map(
  commands.map((command) => [command.data.name, command] as const),
);
