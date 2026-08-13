export type LeaderboardAnnouncementScope = "daily" | "weekly" | "yearly";

export interface LeaderboardAnnouncementDelivery {
  guildId: string;
  scope: LeaderboardAnnouncementScope;
  resetAt: Date;
}

export interface LeaderboardAnnouncementDeliveryService {
  claim(input: LeaderboardAnnouncementDelivery & { now: Date }): Promise<boolean>;

  markDelivered(
    input: LeaderboardAnnouncementDelivery & { deliveredAt: Date },
  ): Promise<void>;

  releaseForRetry(
    input: LeaderboardAnnouncementDelivery & { error: string },
  ): Promise<void>;
}
