export type LeaderboardScope = "all" | "weekly" | "monthly" | "yearly";

export const LEADERBOARD_PAGE_SIZE = 10;
export const LEADERBOARD_MAX_ENTRIES = 100;

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  xp: number;
}

export interface LeaderboardPage {
  scope: LeaderboardScope;
  page: number;
  pageSize: typeof LEADERBOARD_PAGE_SIZE;
  totalPages: number;
  participantCount: number;
  visibleEntryCount: number;
  entries: readonly LeaderboardEntry[];
  timezone: string;
  periodStart: string | null;
  periodEnd: string | null;
  launchLimited: boolean;
  generatedAt: Date;
}

/** Query contract for paginated, guild-specific leaderboards. */
export interface LeaderboardService {
  getPage(input: {
    guildId: string;
    scope: LeaderboardScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardPage>;
}
