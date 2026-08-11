export interface MemberXpStats {
  guildId: string;
  userId: string;
  legacyXpRaw: number;
  legacyXpAdjusted: number;
  newBotXp: number;
  allTimeXp: number;
  rank: number | null;
}

export interface GuildMemberXpBalance {
  userId: string;
  allTimeXp: number;
}

export interface MemberXpService {
  getMemberStats(guildId: string, userId: string): Promise<MemberXpStats>;
  listGuildMemberXp(guildId: string): Promise<readonly GuildMemberXpBalance[]>;
}
