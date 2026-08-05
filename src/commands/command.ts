import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { MemberXpService } from "../services/xp/member-xp-service.js";
import type { LeaderboardService } from "../services/leaderboards/leaderboard-service.js";

export interface CommandContext {
  memberXpService: MemberXpService;
  leaderboardService: LeaderboardService;
}

export interface SlashCommandData {
  readonly name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface BotCommand {
  data: SlashCommandData;
  execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext,
  ): Promise<void>;
}
