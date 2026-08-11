export type ReactionLeaderboardMetric = "received" | "given";

export const REACTION_LEADERBOARD_PAGE_SIZE = 10;
export const REACTION_LEADERBOARD_MAX_ENTRIES = 100;

export interface ReactionMembershipInput {
  guildId: string;
  messageId: string;
  emojiKey: string;
  reactorUserId: string;
}

export interface AddReactionInput extends ReactionMembershipInput {
  messageAuthorId: string;
  createdAt: Date;
}

export interface ReactionLeaderboardEntry {
  rank: number;
  userId: string;
  count: number;
}

export interface ReactionLeaderboardPage {
  metric: ReactionLeaderboardMetric;
  page: number;
  pageSize: typeof REACTION_LEADERBOARD_PAGE_SIZE;
  totalPages: number;
  participantCount: number;
  visibleEntryCount: number;
  entries: readonly ReactionLeaderboardEntry[];
  generatedAt: Date;
}

export interface ReactionService {
  addReaction(input: AddReactionInput): Promise<{ applied: boolean }>;
  removeReaction(input: ReactionMembershipInput): Promise<{ applied: boolean }>;
  clearReactions(input: {
    guildId: string;
    messageId: string;
    emojiKey?: string;
  }): Promise<{ removedCount: number }>;
  getLeaderboardPage(input: {
    guildId: string;
    metric: ReactionLeaderboardMetric;
    page: number;
    now: Date;
  }): Promise<ReactionLeaderboardPage>;
}
