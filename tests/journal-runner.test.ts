import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Client, MessageCreateOptions } from "discord.js";

import {
  DAILY_MESSAGE_CHARACTER_LIMIT,
  JournalRunner,
  isWeeklyJournalBoundary,
} from "../src/services/journal/journal-runner.js";
import type {
  JournalMessage,
  JournalRetainedSummary,
  JournalService,
  JournalSession,
} from "../src/services/journal/journal-service.js";
import type {
  JournalSummarizer,
  JournalSummaryInput,
  JournalWeeklySummaryInput,
} from "../src/services/journal/journal-summarizer.js";

const session: JournalSession = {
  id: 7,
  guildId: "939811280657719327",
  userId: "939644859092992060",
  status: "summarizing",
  startedAt: new Date("2026-09-02T00:00:00.000Z"),
  endsAt: new Date("2026-09-03T00:00:00.000Z"),
  summaryText: undefined,
  publicSummaryText: undefined,
  privateDeliveredAt: undefined,
  publicDeliveredAt: undefined,
  messageCount: 1,
  deliveryAttempts: 1,
};

const messages: JournalMessage[] = [
  {
    messageId: "1",
    channelId: "10",
    channelName: "general",
    content: "Finished the report.",
    createdAt: new Date("2026-09-02T10:00:00.000Z"),
  },
];

class FakeJournalService implements JournalService {
  public saved: Parameters<JournalService["saveSummaries"]>[0][] = [];
  public destinationDeliveries: Parameters<
    JournalService["markDestinationDelivered"]
  >[0][] = [];
  public delivered: Parameters<JournalService["markDelivered"]>[0][] = [];
  public retries: number[] = [];
  public retained: JournalRetainedSummary[] = [];
  public dueSessions: JournalSession[] = [session];

  public async claimDue(): Promise<readonly JournalSession[]> {
    return this.dueSessions;
  }
  public async listMessages(): Promise<readonly JournalMessage[]> {
    return messages;
  }
  public async saveSummaries(
    input: Parameters<JournalService["saveSummaries"]>[0],
  ): Promise<void> {
    this.saved.push(input);
  }
  public async markDestinationDelivered(
    input: Parameters<JournalService["markDestinationDelivered"]>[0],
  ): Promise<void> {
    this.destinationDeliveries.push(input);
  }
  public async listRetainedSummaries(): Promise<readonly JournalRetainedSummary[]> {
    return this.retained;
  }
  public async markDelivered(
    input: Parameters<JournalService["markDelivered"]>[0],
  ): Promise<void> {
    this.delivered.push(input);
  }
  public async releaseForRetry(input: { sessionId: number }): Promise<void> {
    this.retries.push(input.sessionId);
  }
  public async start(): Promise<JournalSession> {
    return session;
  }
  public async getCurrent(): Promise<JournalSession> {
    return session;
  }
  public async finishNow(): Promise<boolean> {
    return true;
  }
  public async cancel(): Promise<boolean> {
    return true;
  }
  public async recordMessage(): Promise<boolean> {
    return true;
  }
}

class FakeSummarizer implements JournalSummarizer {
  public dailyInputs: JournalSummaryInput[] = [];
  public weeklyInputs: JournalWeeklySummaryInput[] = [];
  public publicWeeklyInputs: JournalWeeklySummaryInput[] = [];
  public dailyOutput = "A short private summary.";
  public weeklyOutput = "A useful weekly summary.";
  public publicWeeklyOutput = "A Minecraft-focused public update.";

  public async summarizeDaily(input: JournalSummaryInput): Promise<string> {
    this.dailyInputs.push(input);
    return this.dailyOutput;
  }

  public async summarizeWeekly(input: JournalWeeklySummaryInput): Promise<string> {
    this.weeklyInputs.push(input);
    return this.weeklyOutput;
  }

  public async summarizePublicWeekly(
    input: JournalWeeklySummaryInput,
  ): Promise<string> {
    this.publicWeeklyInputs.push(input);
    return this.publicWeeklyOutput;
  }
}

describe("journal runner", () => {
  it("summarizes, DMs only the target user, and marks delivery complete", async () => {
    const sent: MessageCreateOptions[] = [];
    const client = {
      users: {
        fetch: async (userId: string) => {
          assert.equal(userId, session.userId);
          return {
            send: async (message: MessageCreateOptions) => {
              sent.push(message);
            },
          };
        },
      },
    } as unknown as Client;
    const service = new FakeJournalService();
    const summarizer = new FakeSummarizer();
    const runner = new JournalRunner(
      client,
      service,
      summarizer,
      "Europe/Berlin",
    );

    assert.equal(await runner.runOnce(), 1);
    assert.equal(summarizer.dailyInputs.length, 1);
    assert.equal(summarizer.weeklyInputs.length, 0);
    assert.deepEqual(service.saved, [
      {
        sessionId: 7,
        summaryText: "A short private summary.",
        publicSummaryText: undefined,
      },
    ]);
    assert.equal(service.destinationDeliveries[0]?.destination, "private");
    assert.equal(service.delivered[0]?.sessionId, 7);
    assert.equal(service.delivered[0]?.clearRetainedSummaries, false);
    assert.deepEqual(service.retries, []);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0]?.content), /Your daily Yapper retro/);
    assert.match(String(sent[0]?.content), /A short private summary/);
    assert.equal(sent[0]?.embeds, undefined);
    assert.equal(sent[0]?.files, undefined);
    assert.ok(String(sent[0]?.content).length <= DAILY_MESSAGE_CHARACTER_LIMIT);
    assert.deepEqual(sent[0]?.allowedMentions, { parse: [] });
    assert.equal(sent[0]?.nonce, "yj-7");
  });

  it("queues a retry without sending transcript text to logs or channels", async () => {
    const client = {
      users: { fetch: async () => Promise.reject(new Error("DMs are closed")) },
    } as unknown as Client;
    const service = new FakeJournalService();
    const runner = new JournalRunner(
      client,
      service,
      new FakeSummarizer(),
      "Europe/Berlin",
    );

    assert.equal(await runner.runOnce(), 0);
    assert.deepEqual(service.delivered, []);
    assert.deepEqual(service.retries, [7]);
  });

  it("hard-limits a daily retro to half a normal Discord message", async () => {
    const sent: MessageCreateOptions[] = [];
    const client = {
      users: {
        fetch: async () => ({
          send: async (message: MessageCreateOptions) => sent.push(message),
        }),
      },
    } as unknown as Client;
    const service = new FakeJournalService();
    const summarizer = new FakeSummarizer();
    summarizer.dailyOutput = "Very busy day. ".repeat(200);
    const runner = new JournalRunner(
      client,
      service,
      summarizer,
      "Europe/Berlin",
    );

    assert.equal(await runner.runOnce(), 1);
    assert.ok(String(sent[0]?.content).length <= DAILY_MESSAGE_CHARACTER_LIMIT);
    assert.ok(String(sent[0]?.content).length > 900);
    assert.equal(sent[0]?.files, undefined);
  });

  it("replaces the Sunday daily retro with a weekly embed", async () => {
    const weeklySession: JournalSession = {
      ...session,
      id: 14,
      startedAt: new Date("2026-09-05T22:00:00.000Z"),
      endsAt: new Date("2026-09-06T22:00:00.000Z"),
      messageCount: 25,
    };
    const sent: MessageCreateOptions[] = [];
    const client = {
      users: {
        fetch: async () => ({
          send: async (message: MessageCreateOptions) => sent.push(message),
        }),
      },
    } as unknown as Client;
    const service = new FakeJournalService();
    service.dueSessions = [weeklySession];
    service.retained = [
      {
        startedAt: new Date("2026-08-31T22:00:00.000Z"),
        endsAt: new Date("2026-09-01T22:00:00.000Z"),
        summaryText: "Monday retro.",
      },
    ];
    const summarizer = new FakeSummarizer();
    summarizer.weeklyOutput = "Weekly insight. ".repeat(400);
    const runner = new JournalRunner(
      client,
      service,
      summarizer,
      "Europe/Berlin",
    );

    assert.equal(await runner.runOnce(), 1);
    assert.equal(summarizer.dailyInputs.length, 1);
    assert.equal(summarizer.weeklyInputs.length, 1);
    assert.equal(summarizer.weeklyInputs[0]?.dailySummaries.length, 2);
    assert.equal(
      summarizer.weeklyInputs[0]?.startedAt.toISOString(),
      "2026-08-30T22:00:00.000Z",
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.content, undefined);
    assert.equal(sent[0]?.embeds?.length, 1);
    assert.equal(sent[0]?.files, undefined);
    const rawEmbed = sent[0]?.embeds?.[0];
    const embed =
      rawEmbed && "toJSON" in rawEmbed ? rawEmbed.toJSON() : rawEmbed;
    assert.match(JSON.stringify(embed), /Your weekly Yapper retro/);
    assert.ok((embed?.description?.length ?? 0) <= 4_096);
    assert.ok((service.saved[0]?.summaryText.length ?? 0) <= 4_000);
    assert.equal(service.delivered[0]?.clearRetainedSummaries, true);
  });

  it("posts a separate Minecraft-focused weekly update with only the configured role ping", async () => {
    const weeklySession: JournalSession = {
      ...session,
      id: 21,
      startedAt: new Date("2026-09-05T22:00:00.000Z"),
      endsAt: new Date("2026-09-06T22:00:00.000Z"),
    };
    const privateMessages: MessageCreateOptions[] = [];
    const publicMessages: MessageCreateOptions[] = [];
    const client = {
      users: {
        fetch: async () => ({
          send: async (message: MessageCreateOptions) =>
            privateMessages.push(message),
        }),
      },
      channels: {
        fetch: async (channelId: string) => {
          assert.equal(channelId, "1241133328518873108");
          return {
            guildId: weeklySession.guildId,
            isSendable: () => true,
            send: async (message: MessageCreateOptions) =>
              publicMessages.push(message),
          };
        },
      },
    } as unknown as Client;
    const service = new FakeJournalService();
    service.dueSessions = [weeklySession];
    const summarizer = new FakeSummarizer();
    const runner = new JournalRunner(
      client,
      service,
      summarizer,
      "Europe/Berlin",
      {
        channelId: "1241133328518873108",
        roleId: "1241134136106811432",
      },
    );

    assert.equal(await runner.runOnce(), 1);
    assert.equal(summarizer.weeklyInputs.length, 1);
    assert.equal(summarizer.publicWeeklyInputs.length, 1);
    assert.equal(privateMessages.length, 1);
    assert.equal(publicMessages.length, 1);
    assert.equal(publicMessages[0]?.content, "<@&1241134136106811432>");
    assert.deepEqual(publicMessages[0]?.allowedMentions, {
      parse: [],
      roles: ["1241134136106811432"],
    });
    assert.equal(publicMessages[0]?.nonce, "yj-public-21");
    assert.match(
      JSON.stringify(publicMessages[0]?.embeds?.[0]),
      /Weekly Update/,
    );
    assert.equal(
      service.saved[0]?.publicSummaryText,
      "A Minecraft-focused public update.",
    );
    assert.deepEqual(
      service.destinationDeliveries.map((delivery) => delivery.destination),
      ["private", "public"],
    );
  });

  it("reuses persisted weekly text and skips a private DM already delivered before a retry", async () => {
    const weeklySession: JournalSession = {
      ...session,
      id: 22,
      startedAt: new Date("2026-09-05T22:00:00.000Z"),
      endsAt: new Date("2026-09-06T22:00:00.000Z"),
      summaryText: "Persisted private weekly retro.",
      publicSummaryText: "Persisted public weekly update.",
      privateDeliveredAt: new Date("2026-09-06T22:00:10.000Z"),
    };
    let publicSends = 0;
    const client = {
      users: {
        fetch: async () => {
          throw new Error("The private DM must not be retried.");
        },
      },
      channels: {
        fetch: async () => ({
          guildId: weeklySession.guildId,
          isSendable: () => true,
          send: async () => {
            publicSends += 1;
          },
        }),
      },
    } as unknown as Client;
    const service = new FakeJournalService();
    service.dueSessions = [weeklySession];
    const summarizer = new FakeSummarizer();
    const runner = new JournalRunner(
      client,
      service,
      summarizer,
      "Europe/Berlin",
      {
        channelId: "1241133328518873108",
        roleId: "1241134136106811432",
      },
    );

    assert.equal(await runner.runOnce(), 1);
    assert.equal(publicSends, 1);
    assert.equal(summarizer.dailyInputs.length, 0);
    assert.equal(summarizer.weeklyInputs.length, 0);
    assert.equal(summarizer.publicWeeklyInputs.length, 0);
    assert.equal(service.saved.length, 0);
    assert.deepEqual(
      service.destinationDeliveries.map((delivery) => delivery.destination),
      ["public"],
    );
  });

  it("recognizes only the Sunday-to-Monday local midnight as weekly", () => {
    assert.equal(
      isWeeklyJournalBoundary(
        new Date("2026-09-06T22:00:00.000Z"),
        "Europe/Berlin",
      ),
      true,
    );
    assert.equal(
      isWeeklyJournalBoundary(
        new Date("2026-09-07T22:00:00.000Z"),
        "Europe/Berlin",
      ),
      false,
    );
    assert.equal(
      isWeeklyJournalBoundary(
        new Date("2026-09-07T10:00:00.000Z"),
        "Europe/Berlin",
      ),
      false,
    );
  });
});
