export interface EmojiUsageEvent {
  guildId: string;
  userId: string;
  channelId: string;
  emojiKey: string;
  source: "message" | "reaction";
  amount: number;
  createdAt: Date;
}

/** Placeholder for the privacy-conscious Phase 9 emoji tracking module. */
export interface EmojiService {
  record(event: EmojiUsageEvent): Promise<void>;
}
