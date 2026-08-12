export interface Reminder {
  id: number;
  guildId: string;
  userId: string;
  channelId: string;
  message: string;
  remindAt: Date;
  deliveryAttempts: number;
}

export interface ReminderService {
  create(input: {
    guildId: string;
    userId: string;
    channelId: string;
    message: string;
    remindAt: Date;
  }): Promise<Reminder>;

  list(input: {
    guildId: string;
    userId: string;
    limit: number;
  }): Promise<readonly Reminder[]>;

  cancel(input: {
    guildId: string;
    userId: string;
    reminderId: number;
  }): Promise<boolean>;

  claimDue(input: {
    now: Date;
    limit: number;
  }): Promise<readonly Reminder[]>;

  markDelivered(reminderId: number, deliveredAt: Date): Promise<void>;

  releaseForRetry(input: {
    reminderId: number;
    error: string;
  }): Promise<void>;
}
