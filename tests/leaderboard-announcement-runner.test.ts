import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Client, MessageCreateOptions } from "discord.js";

import {
  buildLeaderboardAnnouncementMessage,
  findDueLeaderboardAnnouncements,
  LeaderboardAnnouncementRunner,
} from "../src/services/leaderboards/leaderboard-announcement-runner.js";
import type {
  LeaderboardAnnouncementDelivery,
  LeaderboardAnnouncementDeliveryService,
} from "../src/services/leaderboards/leaderboard-announcement-service.js";
import type {
  LeaderboardPage,
  LeaderboardResetSchedule,
  LeaderboardService,
} from "../src/services/leaderboards/leaderboard-service.js";
import { calculateLeaderboardResetSchedule } from "../src/services/leaderboards/leaderboard-period.js";

const guildId = "939811280657719327";
const channelId = "1042371032406822942";
const dailyReset = new Date("2026-08-13T22:00:00.000Z");

const schedule: LeaderboardResetSchedule = {
  timezone: "Europe/Berlin",
  daily: dailyReset,
  weekly: new Date("2026-08-16T22:00:00.000Z"),
  monthly: new Date("2026-08-31T22:00:00.000Z"),
  yearly: new Date("2026-12-31T23:00:00.000Z"),
};

function examplePage(): LeaderboardPage {
  return {
    kind: "current",
    scope: "daily",
    page: 1,
    pageSize: 10,
    totalPages: 1,
    participantCount: 0,
    visibleEntryCount: 0,
    entries: [],
    timezone: "Europe/Berlin",
    periodStart: "2026-08-13",
    periodEnd: "2026-08-13",
    launchLimited: false,
    generatedAt: new Date("2026-08-13T21:59:30.000Z"),
  };
}

class FakeDeliveryService implements LeaderboardAnnouncementDeliveryService {
  public claims: LeaderboardAnnouncementDelivery[] = [];
  public delivered: LeaderboardAnnouncementDelivery[] = [];
  public retries: LeaderboardAnnouncementDelivery[] = [];
  public allowClaim = true;

  public async claim(
    input: LeaderboardAnnouncementDelivery & { now: Date },
  ): Promise<boolean> {
    this.claims.push(input);
    return this.allowClaim;
  }

  public async markDelivered(
    input: LeaderboardAnnouncementDelivery & { deliveredAt: Date },
  ): Promise<void> {
    this.delivered.push(input);
  }

  public async releaseForRetry(
    input: LeaderboardAnnouncementDelivery & { error: string },
  ): Promise<void> {
    this.retries.push(input);
  }
}

function fakeLeaderboardService(): LeaderboardService {
  return {
    getResetSchedule: async () => schedule,
    getPage: async () => examplePage(),
  } as unknown as LeaderboardService;
}

describe("leaderboard announcement scheduling", () => {
  it("selects only resets inside the final minute", () => {
    assert.deepEqual(
      findDueLeaderboardAnnouncements(
        schedule,
        new Date("2026-08-13T21:59:00.000Z"),
      ).map((announcement) => announcement.scope),
      ["daily"],
    );
    assert.deepEqual(
      findDueLeaderboardAnnouncements(
        {
          ...schedule,
          daily: new Date("2026-08-16T22:00:00.000Z"),
        },
        new Date("2026-08-16T21:59:30.000Z"),
      ).map((announcement) => announcement.scope),
      ["daily", "weekly"],
    );
    assert.deepEqual(
      findDueLeaderboardAnnouncements(
        schedule,
        new Date("2026-08-13T21:58:59.999Z"),
      ),
      [],
    );
  });

  it("claims, sends, and marks the final daily leaderboard", async () => {
    const sent: MessageCreateOptions[] = [];
    const client = {
      channels: {
        fetch: async (requestedChannelId: string) => {
          assert.equal(requestedChannelId, channelId);
          return {
            isSendable: () => true,
            send: async (message: MessageCreateOptions) => {
              sent.push(message);
            },
          };
        },
      },
    } as unknown as Client;
    const deliveryService = new FakeDeliveryService();
    const runner = new LeaderboardAnnouncementRunner(
      client,
      fakeLeaderboardService(),
      deliveryService,
      { guildId, channelId },
      async () => ({ content: "final daily leaderboard" }),
    );

    assert.equal(
      await runner.runOnce(new Date("2026-08-13T21:59:30.000Z")),
      1,
    );
    assert.equal(deliveryService.claims[0]?.scope, "daily");
    assert.equal(deliveryService.delivered[0]?.scope, "daily");
    assert.deepEqual(deliveryService.retries, []);
    assert.deepEqual(sent, [{ content: "final daily leaderboard" }]);
  });

  it("selects monthly and yearly boards alongside other coinciding resets", () => {
    for (const [instant, expected] of [
      ["2026-08-31T21:59:30.000Z", ["daily", "monthly"]],
      ["2026-12-31T22:59:30.000Z", ["daily", "monthly", "yearly"]],
    ] as const) {
      const now = new Date(instant);
      const resetSchedule = calculateLeaderboardResetSchedule({ now, timezone: "Europe/Berlin" });
      assert.deepEqual(
        findDueLeaderboardAnnouncements(resetSchedule, now).map((entry) => entry.scope),
        expected,
      );
    }
  });

  it("delivers monthly and yearly boards to the configured channel and respects delivery claims", async () => {
    const now = new Date("2026-12-31T22:59:30.000Z");
    const loadedScopes: string[] = [];
    const sent: MessageCreateOptions[] = [];
    const client = {
      channels: {
        fetch: async (id: string) => {
          assert.equal(id, channelId);
          return {
            isSendable: () => true,
            send: async (message: MessageCreateOptions) => { sent.push(message); },
          };
        },
      },
    } as unknown as Client;
    const service = {
      getResetSchedule: async () => calculateLeaderboardResetSchedule({ now, timezone: "Europe/Berlin" }),
      getPage: async (input: Parameters<LeaderboardService["getPage"]>[0]) => {
        assert.equal(input.guildId, guildId);
        assert.equal(input.page, 1);
        assert.equal(input.now, now);
        loadedScopes.push(input.scope);
        return { ...examplePage(), scope: input.scope };
      },
    } as unknown as LeaderboardService;
    const deliveryService = new FakeDeliveryService();
    const runner = new LeaderboardAnnouncementRunner(
      client, service, deliveryService, { guildId, channelId },
      async ({ page }) => ({ content: `final ${page.scope} leaderboard` }),
    );
    assert.equal(await runner.runOnce(now), 3);
    assert.deepEqual(loadedScopes, ["daily", "monthly", "yearly"]);
    assert.deepEqual(sent.map((message) => message.content), [
      "final daily leaderboard", "final monthly leaderboard", "final yearly leaderboard",
    ]);
    assert.deepEqual(deliveryService.delivered.map((delivery) => delivery.scope), loadedScopes);
    deliveryService.allowClaim = false;
    assert.equal(await runner.runOnce(now), 0);
    assert.equal(sent.length, 3);
  });

  it("releases a claimed announcement when the channel cannot be used", async () => {
    const client = {
      channels: { fetch: async () => null },
    } as unknown as Client;
    const deliveryService = new FakeDeliveryService();
    const runner = new LeaderboardAnnouncementRunner(
      client,
      fakeLeaderboardService(),
      deliveryService,
      { guildId, channelId },
    );

    assert.equal(
      await runner.runOnce(new Date("2026-08-13T21:59:30.000Z")),
      0,
    );
    assert.equal(deliveryService.retries[0]?.scope, "daily");
  });

  it("builds a no-ping, duplicate-protected image announcement", async () => {
    const client = {
      user: { id: "1534529857285787771" },
    } as unknown as Client;
    const message = await buildLeaderboardAnnouncementMessage(
      client,
      examplePage(),
      dailyReset,
    );

    assert.equal(
      message.content,
      "**Final daily leaderboard** — resets <t:1786658400:R>.",
    );
    assert.deepEqual(message.allowedMentions, { parse: [] });
    assert.equal(message.nonce, "yla-d-1786658400");
    assert.equal(message.enforceNonce, true);
    assert.equal(message.components, undefined);
    assert.equal(message.files?.length, 1);
  });

  it("labels monthly and yearly announcements with separate duplicate-protection nonces", async () => {
    const client = { user: { id: "1534529857285787771" } } as unknown as Client;
    const messages = [];
    for (const scope of ["monthly", "yearly"] as const) {
      const message = await buildLeaderboardAnnouncementMessage(
        client, { ...examplePage(), scope }, schedule.yearly,
      );
      assert.match(message.content ?? "", new RegExp(`Final ${scope} leaderboard`));
      assert.deepEqual(message.allowedMentions, { parse: [] });
      assert.equal(message.enforceNonce, true);
      assert.equal(message.components, undefined);
      assert.equal(message.files?.length, 1);
      messages.push(message);
    }
    assert.notEqual(messages[0]?.nonce, messages[1]?.nonce);
  });
});
