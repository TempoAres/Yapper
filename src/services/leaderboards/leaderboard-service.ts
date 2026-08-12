export type LeaderboardScope = "all" | "weekly" | "monthly" | "yearly";
export type LeaderboardRecordScope = Exclude<LeaderboardScope, "all">;
export type LeaderboardKind = "current" | "record";

export const LEADERBOARD_PAGE_SIZE = 10;
export const LEADERBOARD_MAX_ENTRIES = 100;

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  xp: number;
  allTimeXp: number;
  recordStart: string | null;
  recordEnd: string | null;
}

export interface LeaderboardPage {
  kind: LeaderboardKind;
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

export interface LeaderboardResetSchedule {
  timezone: string;
  weekly: Date;
  monthly: Date;
  yearly: Date;
}

export interface LeaderboardWinEntry {
  rank: number;
  userId: string;
  wins: number;
}

export interface LeaderboardWinPage {
  scope: LeaderboardRecordScope;
  page: number;
  pageSize: typeof LEADERBOARD_PAGE_SIZE;
  totalPages: number;
  participantCount: number;
  visibleEntryCount: number;
  entries: readonly LeaderboardWinEntry[];
  timezone: string;
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

  getRecordPage(input: {
    guildId: string;
    scope: LeaderboardRecordScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardPage>;

  getResetSchedule(input: {
    guildId: string;
    now: Date;
  }): Promise<LeaderboardResetSchedule>;

  getWinPage(input: {
    guildId: string;
    scope: LeaderboardRecordScope;
    page: number;
    now: Date;
  }): Promise<LeaderboardWinPage>;
}
