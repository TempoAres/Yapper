import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { MemberXpService } from "../services/xp/member-xp-service.js";
import type { LeaderboardService } from "../services/leaderboards/leaderboard-service.js";
import type { AdminXpService } from "../services/xp/admin-xp-service.js";
import type { RecentXpService } from "../services/xp/recent-xp-service.js";
import type { RoleRewardService } from "../services/roles/role-reward-service.js";
import type { RoleRewardCoordinator } from "../services/roles/role-sync.js";
import type { ReactionService } from "../services/reactions/reaction-service.js";
import type { EmojiService } from "../services/emoji/emoji-service.js";
import type { ReminderService } from "../services/reminders/reminder-service.js";
import type { JournalService } from "../services/journal/journal-service.js";

export interface JournalCommandConfig {
  targetUserId: string | undefined;
  summarizationConfigured: boolean;
}

export interface CommandContext {
  memberXpService: MemberXpService;
  leaderboardService: LeaderboardService;
  adminXpService: AdminXpService;
  recentXpService: RecentXpService;
  roleRewardService: RoleRewardService;
  roleRewardCoordinator: RoleRewardCoordinator;
  reactionService: ReactionService;
  emojiService: EmojiService;
  reminderService: ReminderService;
  journalService: JournalService;
  journalConfig: JournalCommandConfig;
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
