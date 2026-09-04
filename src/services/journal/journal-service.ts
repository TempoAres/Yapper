export type JournalStatus =
  | "active"
  | "summarizing"
  | "awaiting_delivery"
  | "delivered"
  | "cancelled";

export interface JournalSession {
  id: number;
  guildId: string;
  userId: string;
  status: JournalStatus;
  startedAt: Date;
  endsAt: Date;
  summaryText: string | undefined;
  messageCount: number;
  deliveryAttempts: number;
}

export interface JournalMessage {
  messageId: string;
  channelId: string;
  channelName: string;
  content: string;
  createdAt: Date;
}

export interface JournalRetainedSummary {
  startedAt: Date;
  endsAt: Date;
  summaryText: string;
}

export interface JournalService {
  start(input: {
    guildId: string;
    userId: string;
    startedAt: Date;
    endsAt: Date;
  }): Promise<JournalSession>;

  getCurrent(input: {
    guildId: string;
    userId: string;
  }): Promise<JournalSession | undefined>;

  finishNow(input: {
    guildId: string;
    userId: string;
    now: Date;
  }): Promise<boolean>;

  cancel(input: { guildId: string; userId: string }): Promise<boolean>;

  recordMessage(input: {
    guildId: string;
    userId: string;
    messageId: string;
    channelId: string;
    channelName: string;
    content: string;
    createdAt: Date;
  }): Promise<boolean>;

  claimDue(input: {
    now: Date;
    limit: number;
  }): Promise<readonly JournalSession[]>;

  listMessages(sessionId: number): Promise<readonly JournalMessage[]>;

  listRetainedSummaries(input: {
    guildId: string;
    userId: string;
    from: Date;
    through: Date;
  }): Promise<readonly JournalRetainedSummary[]>;

  saveSummary(sessionId: number, summaryText: string): Promise<void>;

  markDelivered(input: {
    sessionId: number;
    deliveredAt: Date;
    clearRetainedSummaries: boolean;
  }): Promise<void>;

  releaseForRetry(input: { sessionId: number; error: string }): Promise<void>;
}
