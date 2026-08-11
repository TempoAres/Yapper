import type { LeaderboardScope } from "../leaderboards/leaderboard-service.js";

export const EMOJI_LEADERBOARD_PAGE_SIZE = 10;
export const EMOJI_LEADERBOARD_MAX_ENTRIES = 100;

export type EmojiLeaderboardMetric = "users" | "emojis";

export interface EmojiUsageCount {
  emojiKey: string;
  amount: number;
}

export interface EmojiMessageUsageInput {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  usages: readonly EmojiUsageCount[];
  createdAt: Date;
}

export interface EmojiLeaderboardEntry {
  rank: number;
  key: string;
  count: number;
}

export interface EmojiLeaderboardPage {
  metric: EmojiLeaderboardMetric;
  scope: LeaderboardScope;
  page: number;
  pageSize: typeof EMOJI_LEADERBOARD_PAGE_SIZE;
  totalPages: number;
  participantCount: number;
  visibleEntryCount: number;
  entries: readonly EmojiLeaderboardEntry[];
  timezone: string;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: Date;
}

export interface EmojiService {
  recordMessage(input: EmojiMessageUsageInput): Promise<{ recorded: number }>;
  getLeaderboardPage(input: {
    guildId: string;
    metric: EmojiLeaderboardMetric;
    scope: LeaderboardScope;
    page: number;
    now: Date;
  }): Promise<EmojiLeaderboardPage>;
}
