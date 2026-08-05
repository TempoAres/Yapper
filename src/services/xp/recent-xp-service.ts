import type { XpSource } from "./xp-service.js";

export interface RecentXpEntry {
  amount: number;
  source: XpSource;
  channelId: string | null;
  messageId: string | null;
  actorUserId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface RecentXpService {
  getRecent(input: {
    guildId: string;
    userId: string;
    limit: number;
  }): Promise<readonly RecentXpEntry[]>;
}
