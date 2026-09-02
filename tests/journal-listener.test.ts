import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageType, type Message } from "discord.js";

import {
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
  public async saveSummary(): Promise<void> {}
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
});
