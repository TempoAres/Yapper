export type LeaderboardScope = "all" | "weekly" | "monthly" | "yearly";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  xp: number;
}

/** Query contract for the paginated, guild-specific Phase 4 leaderboards. */
export interface LeaderboardService {
  getPage(input: {
    guildId: string;
    scope: LeaderboardScope;
    page: number;
    pageSize: 10;
    now: Date;
  }): Promise<readonly LeaderboardEntry[]>;
}
