export type XpSource =
  | "message"
  | "image"
  | "thread"
  | "forum"
  | "admin"
  | "import"
  | "reaction";

export interface AwardXpInput {
  guildId: string;
  userId: string;
  channelId: string;
  discordEventId: string;
  messageId?: string;
  amount: number;
  source: XpSource;
  createdAt: Date;
}

/** Contract for Phase 3. PostgreSQL will implement it transactionally. */
export interface XpService {
  award(input: AwardXpInput): Promise<{ awarded: boolean }>;
}
