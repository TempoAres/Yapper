import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { MemberXpService } from "../services/xp/member-xp-service.js";
import type { LeaderboardService } from "../services/leaderboards/leaderboard-service.js";
import type { AdminXpService } from "../services/xp/admin-xp-service.js";
import type { RecentXpService } from "../services/xp/recent-xp-service.js";

export interface CommandContext {
  memberXpService: MemberXpService;
  leaderboardService: LeaderboardService;
  adminXpService: AdminXpService;
  recentXpService: RecentXpService;
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
