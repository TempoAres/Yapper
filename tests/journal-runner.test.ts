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
  public saved: string[] = [];
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
  public async saveSummary(_sessionId: number, summary: string): Promise<void> {
    this.saved.push(summary);
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
  public dailyOutput = "A short private summary.";
  public weeklyOutput = "A useful weekly summary.";

  public async summarizeDaily(input: JournalSummaryInput): Promise<string> {
    this.dailyInputs.push(input);
    return this.dailyOutput;
  }

  public async summarizeWeekly(input: JournalWeeklySummaryInput): Promise<string> {
    this.weeklyInputs.push(input);
    return this.weeklyOutput;
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
    assert.deepEqual(service.saved, ["A short private summary."]);
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
    assert.ok((service.saved[0]?.length ?? 0) <= 4_000);
    assert.equal(service.delivered[0]?.clearRetainedSummaries, true);
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
