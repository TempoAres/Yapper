import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Client, MessageCreateOptions } from "discord.js";

import { JournalRunner } from "../src/services/journal/journal-runner.js";
import type {
  JournalMessage,
  JournalService,
  JournalSession,
} from "../src/services/journal/journal-service.js";
import type {
  JournalSummarizer,
  JournalSummaryInput,
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
  public delivered: number[] = [];
  public retries: number[] = [];

  public async claimDue(): Promise<readonly JournalSession[]> {
    return [session];
  }
  public async listMessages(): Promise<readonly JournalMessage[]> {
    return messages;
  }
  public async saveSummary(_sessionId: number, summary: string): Promise<void> {
    this.saved.push(summary);
  }
  public async markDelivered(sessionId: number): Promise<void> {
    this.delivered.push(sessionId);
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
  public inputs: JournalSummaryInput[] = [];

  public async summarize(input: JournalSummaryInput): Promise<string> {
    this.inputs.push(input);
    return "A short private summary.";
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
    const runner = new JournalRunner(client, service, summarizer);

    assert.equal(await runner.runOnce(), 1);
    assert.equal(summarizer.inputs.length, 1);
    assert.deepEqual(service.saved, ["A short private summary."]);
    assert.deepEqual(service.delivered, [7]);
    assert.deepEqual(service.retries, []);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0]?.content), /Your Yapper journal summary/);
    assert.match(String(sent[0]?.content), /A short private summary/);
    assert.deepEqual(sent[0]?.allowedMentions, { parse: [] });
    assert.equal(sent[0]?.nonce, "yj-7");
  });

  it("queues a retry without sending transcript text to logs or channels", async () => {
    const client = {
      users: { fetch: async () => Promise.reject(new Error("DMs are closed")) },
    } as unknown as Client;
    const service = new FakeJournalService();
    const runner = new JournalRunner(client, service, new FakeSummarizer());

    assert.equal(await runner.runOnce(), 0);
    assert.deepEqual(service.delivered, []);
    assert.deepEqual(service.retries, [7]);
  });
});
