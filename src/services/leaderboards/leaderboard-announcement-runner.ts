import type { Client, MessageCreateOptions } from "discord.js";

import { buildLeaderboardResponse } from "../../commands/leaderboard.js";
import { resolveLeaderboardProfiles } from "./leaderboard-image.js";
import type {
  LeaderboardAnnouncementDeliveryService,
  LeaderboardAnnouncementScope,
} from "./leaderboard-announcement-service.js";
import type {
  LeaderboardPage,
  LeaderboardResetSchedule,
  LeaderboardService,
} from "./leaderboard-service.js";

const POLL_INTERVAL_MS = 15_000;
const ANNOUNCEMENT_LEAD_MS = 60_000;
const announcementScopes = ["daily", "weekly", "yearly"] as const;

const scopeLabels: Record<LeaderboardAnnouncementScope, string> = {
  daily: "Daily",
  weekly: "Weekly",
  yearly: "Yearly",
};

export interface LeaderboardAnnouncementConfig {
  guildId: string;
  channelId: string;
}

export interface DueLeaderboardAnnouncement {
  scope: LeaderboardAnnouncementScope;
  resetAt: Date;
}

type AnnouncementMessageBuilder = (input: {
  page: LeaderboardPage;
  resetAt: Date;
}) => Promise<MessageCreateOptions>;

function announcementNonce(
  scope: LeaderboardAnnouncementScope,
  resetAt: Date,
): string {
  const abbreviation = scope[0];
  return `yla-${abbreviation}-${Math.floor(resetAt.getTime() / 1_000)}`;
}

export function findDueLeaderboardAnnouncements(
  schedule: LeaderboardResetSchedule,
  now: Date,
): readonly DueLeaderboardAnnouncement[] {
  return announcementScopes.flatMap((scope) => {
    const resetAt = schedule[scope];
    const millisecondsUntilReset = resetAt.getTime() - now.getTime();

    return millisecondsUntilReset > 0 &&
      millisecondsUntilReset <= ANNOUNCEMENT_LEAD_MS
      ? [{ scope, resetAt }]
      : [];
  });
}

export async function buildLeaderboardAnnouncementMessage(
  client: Client,
  page: LeaderboardPage,
  resetAt: Date,
): Promise<MessageCreateOptions> {
  const profiles = await resolveLeaderboardProfiles(
    client,
    page.entries.map((entry) => entry.userId),
  );
  const response = await buildLeaderboardResponse(
    page,
    client.user?.id ?? "00000000000000000",
    "level",
    profiles,
  );
  const resetTimestamp = Math.floor(resetAt.getTime() / 1_000);

  return {
    content: `**Final ${scopeLabels[page.scope as LeaderboardAnnouncementScope].toLowerCase()} leaderboard** — resets <t:${resetTimestamp}:R>.`,
    ...(response.embeds ? { embeds: response.embeds } : {}),
    ...(response.files ? { files: response.files } : {}),
    allowedMentions: { parse: [] },
    nonce: announcementNonce(
      page.scope as LeaderboardAnnouncementScope,
      resetAt,
    ),
    enforceNonce: true,
  };
}

export class LeaderboardAnnouncementRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private readonly idleWaiters: Array<() => void> = [];

  public constructor(
    private readonly client: Client,
    private readonly leaderboardService: LeaderboardService,
    private readonly deliveryService: LeaderboardAnnouncementDeliveryService,
    private readonly config: LeaderboardAnnouncementConfig,
    private readonly messageBuilder: AnnouncementMessageBuilder = (input) =>
      buildLeaderboardAnnouncementMessage(
        client,
        input.page,
        input.resetAt,
      ),
  ) {}

  public start(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    void this.tick();
  }

  public async stop(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.running) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    }
  }

  public async runOnce(now = new Date()): Promise<number> {
    const schedule = await this.leaderboardService.getResetSchedule({
      guildId: this.config.guildId,
      now,
    });
    const announcements = findDueLeaderboardAnnouncements(schedule, now);
    let delivered = 0;

    for (const announcement of announcements) {
      const delivery = {
        guildId: this.config.guildId,
        scope: announcement.scope,
        resetAt: announcement.resetAt,
      } as const;

      if (!(await this.deliveryService.claim({ ...delivery, now }))) {
        continue;
      }

      try {
        const channel = await this.client.channels.fetch(this.config.channelId);

        if (!channel?.isSendable()) {
          throw new Error(
            "The leaderboard announcement channel is missing or not sendable.",
          );
        }

        const page = await this.leaderboardService.getPage({
          guildId: this.config.guildId,
          scope: announcement.scope,
          page: 1,
          now,
        });
        const message = await this.messageBuilder({
          page,
          resetAt: announcement.resetAt,
        });
        await channel.send(message);
        await this.deliveryService.markDelivered({
          ...delivery,
          deliveredAt: now,
        });
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.deliveryService.releaseForRetry({
          ...delivery,
          error: message,
        });
        console.error(
          `Could not announce the ${announcement.scope} leaderboard:`,
          error,
        );
      }
    }

    return delivered;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runOnce();
    } catch (error) {
      console.error("Leaderboard announcement check failed:", error);
    } finally {
      this.running = false;
      for (const resolve of this.idleWaiters.splice(0)) {
        resolve();
      }

      if (!this.stopped) {
        this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
        this.timer.unref();
      }
    }
  }
}
