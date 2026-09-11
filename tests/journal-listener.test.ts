import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageType, type Message } from "discord.js";

import {
  JOURNAL_CONTEXT_CHARACTER_LIMIT,
  JournalContextTracker,
  handleJournalMessage,
  journalMessageContent,
} from "../src/bot/journal-listener.js";
import type {
  JournalMessage,
  JournalService,
  JournalSession,
} from "../src/services/journal/journal-service.js";

class FakeJournalService implements JournalService {
  public recorded: Parameters<JournalService["recordMessage"]>[0][] = [];

  public async recordMessage(
    input: Parameters<JournalService["recordMessage"]>[0],
  ): Promise<boolean> {
    this.recorded.push(input);
    return true;
  }

  public async start(): Promise<JournalSession> {
    throw new Error("Not used.");
  }
  public async getCurrent(): Promise<undefined> {
    return undefined;
  }
  public async finishNow(): Promise<boolean> {
    return false;
  }
  public async cancel(): Promise<boolean> {
    return false;
  }
  public async claimDue(): Promise<readonly JournalSession[]> {
    return [];
  }
  public async listMessages(): Promise<readonly JournalMessage[]> {
    return [];
  }
  public async listRetainedSummaries(): Promise<readonly []> {
    return [];
  }
  public async saveSummaries(): Promise<void> {}
  public async markDestinationDelivered(): Promise<void> {}
  public async markDelivered(): Promise<void> {}
  public async releaseForRetry(): Promise<void> {}
}

function fakeMessage(userId = "939644859092992060"): Message {
  return {
    inGuild: () => true,
    author: { id: userId, bot: false },
    webhookId: null,
    system: false,
    type: MessageType.Default,
    content: "I finished the report.",
    attachments: new Map([
      ["attachment-1", { name: "notes.pdf" }],
    ]),
    stickers: new Map([["sticker-1", { name: "Nice" }]]),
    guildId: "939811280657719327",
    channelId: "1042371032406822942",
    channel: { name: "general" },
    id: "message-1",
    createdAt: new Date("2026-09-02T12:00:00.000Z"),
  } as unknown as Message;
}

describe("journal message capture", () => {
  it("records only the configured user's messages with useful context", async () => {
    const service = new FakeJournalService();
    const message = fakeMessage();

    assert.equal(
      await handleJournalMessage(message, service, "939644859092992060"),
      true,
    );
    assert.deepEqual(service.recorded, [
      {
        guildId: "939811280657719327",
        userId: "939644859092992060",
        messageId: "message-1",
        channelId: "1042371032406822942",
        channelName: "general",
        content:
          "I finished the report.\n[Attachment: notes.pdf]\n[Sticker: Nice]",
        createdAt: new Date("2026-09-02T12:00:00.000Z"),
      },
    ]);

    assert.equal(
      await handleJournalMessage(
        fakeMessage("111111111111111111"),
        service,
        "939644859092992060",
      ),
      false,
    );
    assert.equal(service.recorded.length, 1);
  });

  it("describes attachment-only messages without storing remote file URLs", () => {
    const message = fakeMessage() as Message<true>;
    Object.assign(message, { content: "" });

    const content = journalMessageContent(message);
    assert.equal(content, "[Attachment: notes.pdf]\n[Sticker: Nice]");
    assert.doesNotMatch(content, /https?:/);
  });

  it("uses the most recent preceding human message as bounded context", async () => {
    const tracker = new JournalContextTracker();
    const service = new FakeJournalService();
    const otherMessage = fakeMessage("111111111111111111") as Message<true>;
    Object.assign(otherMessage, {
      id: "other-message",
      content: "Could you finish the castle roof?".repeat(100),
      createdAt: new Date("2026-09-02T11:59:00.000Z"),
    });
    const authorMessage = fakeMessage() as Message<true>;

    assert.equal(
      await tracker.observe(otherMessage, "939644859092992060"),
      undefined,
    );
    const context = await tracker.observe(
      authorMessage,
      "939644859092992060",
    );

    assert.equal(context?.messageId, "other-message");
    assert.ok((context?.content.length ?? 0) <= JOURNAL_CONTEXT_CHARACTER_LIMIT);
    assert.equal(context?.createdAt.toISOString(), "2026-09-02T11:59:00.000Z");
    assert.equal("authorId" in (context ?? {}), false);
    assert.equal(
      await handleJournalMessage(
        authorMessage,
        service,
        "939644859092992060",
        context,
      ),
      true,
    );
    assert.deepEqual(service.recorded[0]?.contextMessage, context);
  });

  it("prefers a direct reply target over recent channel context", async () => {
    const tracker = new JournalContextTracker();
    const recentMessage = fakeMessage("111111111111111111") as Message<true>;
    Object.assign(recentMessage, {
      id: "recent-message",
      content: "Unrelated recent topic.",
      createdAt: new Date("2026-09-02T11:59:00.000Z"),
    });
    await tracker.observe(recentMessage, "939644859092992060");

    const replyTarget = fakeMessage("222222222222222222") as Message<true>;
    Object.assign(replyTarget, {
      id: "reply-target",
      content: "How is the Minecraft redstone project going?",
      createdAt: new Date("2026-09-02T10:00:00.000Z"),
    });
    const authorReply = fakeMessage() as Message<true>;
    Object.assign(authorReply, {
      type: MessageType.Reply,
      reference: { messageId: "reply-target" },
      fetchReference: async () => replyTarget,
    });

    const context = await tracker.observe(
      authorReply,
      "939644859092992060",
    );

    assert.equal(context?.messageId, "reply-target");
    assert.match(context?.content ?? "", /Minecraft redstone/);
    assert.doesNotMatch(context?.content ?? "", /Unrelated/);
  });

  it("does not attach stale channel chatter to an unrelated message", async () => {
    const tracker = new JournalContextTracker();
    const otherMessage = fakeMessage("111111111111111111") as Message<true>;
    Object.assign(otherMessage, {
      id: "old-message",
      createdAt: new Date("2026-09-02T10:00:00.000Z"),
    });
    await tracker.observe(otherMessage, "939644859092992060");
    const authorMessage = fakeMessage() as Message<true>;

    assert.equal(
      await tracker.observe(authorMessage, "939644859092992060"),
      undefined,
    );
  });
});
