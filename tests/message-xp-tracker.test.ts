import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MessageXpTracker } from "../src/services/xp/message-xp-tracker.js";
import type {
  AwardXpInput,
  XpService,
} from "../src/services/xp/xp-service.js";

class FakeXpService implements XpService {
  public readonly awards: AwardXpInput[] = [];
  public shouldAward = true;

  public async award(input: AwardXpInput): Promise<{ awarded: boolean }> {
    this.awards.push(input);
    return { awarded: this.shouldAward };
  }
}

const config = {
  minimumXp: 20,
  maximumXp: 30,
  cooldownMilliseconds: 30_000,
  duplicateWindowMilliseconds: 120_000,
};

function messageInput(overrides: Partial<Parameters<MessageXpTracker["process"]>[0]> = {}) {
  return {
    guildId: "guild-1",
    userId: "user-1",
    channelId: "channel-1",
    messageId: "message-1",
    content: "A meaningful message",
    attachmentCount: 0,
    source: "message" as const,
    createdAt: new Date("2026-08-05T12:00:00.000Z"),
    ...overrides,
  };
}

describe("MessageXpTracker", () => {
  it("awards configurable XP without passing message content to storage", async () => {
    const xpService = new FakeXpService();
    const tracker = new MessageXpTracker(xpService, config, () => 0);

    const result = await tracker.process(messageInput());

    assert.deepEqual(result, { awarded: true, amount: 20 });
    assert.equal(xpService.awards.length, 1);
    assert.equal(xpService.awards[0]?.amount, 20);
    assert.equal("content" in (xpService.awards[0] ?? {}), false);
  });

  it("accepts an attachment-only post without inspecting the attachment", async () => {
    const xpService = new FakeXpService();
    const tracker = new MessageXpTracker(xpService, config, () => 0.999);

    const result = await tracker.process(
      messageInput({ content: "", attachmentCount: 1, source: "image" }),
    );

    assert.deepEqual(result, { awarded: true, amount: 30 });
    assert.equal(xpService.awards[0]?.source, "image");
  });

  it("rejects very short, punctuation-only, and repeated-character spam", async () => {
    const xpService = new FakeXpService();
    const tracker = new MessageXpTracker(xpService, config);

    for (const content of ["ok", "!!!", "aaaaaa"]) {
      const result = await tracker.process(
        messageInput({ content, messageId: `message-${content}` }),
      );
      assert.equal(result.reason, "low_effort");
    }

    assert.equal(xpService.awards.length, 0);
  });

  it("enforces the per-member cooldown", async () => {
    const xpService = new FakeXpService();
    const tracker = new MessageXpTracker(xpService, config, () => 0);
    const firstTime = new Date("2026-08-05T12:00:00.000Z");

    await tracker.process(messageInput({ createdAt: firstTime }));
    const duringCooldown = await tracker.process(
      messageInput({
        messageId: "message-2",
        content: "A different useful message",
        createdAt: new Date(firstTime.getTime() + 29_999),
      }),
    );
    const afterCooldown = await tracker.process(
      messageInput({
        messageId: "message-3",
        content: "Another useful message",
        createdAt: new Date(firstTime.getTime() + 30_000),
      }),
    );

    assert.equal(duringCooldown.reason, "cooldown");
    assert.equal(afterCooldown.awarded, true);
    assert.equal(xpService.awards.length, 2);
  });

  it("blocks normalized duplicate content inside the duplicate window", async () => {
    const xpService = new FakeXpService();
    const tracker = new MessageXpTracker(xpService, config, () => 0);
    const firstTime = new Date("2026-08-05T12:00:00.000Z");

    await tracker.process(messageInput({ content: "Hello   Yapper", createdAt: firstTime }));
    const duplicate = await tracker.process(
      messageInput({
        messageId: "message-2",
        content: "  hello yapper  ",
        createdAt: new Date(firstTime.getTime() + 60_000),
      }),
    );
    const expired = await tracker.process(
      messageInput({
        messageId: "message-3",
        content: "hello yapper",
        createdAt: new Date(firstTime.getTime() + 120_000),
      }),
    );

    assert.equal(duplicate.reason, "duplicate_content");
    assert.equal(expired.awarded, true);
    assert.equal(xpService.awards.length, 2);
  });

  it("does not consume cooldown when the database rejects a duplicate event", async () => {
    const xpService = new FakeXpService();
    xpService.shouldAward = false;
    const tracker = new MessageXpTracker(xpService, config, () => 0);

    const duplicateEvent = await tracker.process(messageInput());
    xpService.shouldAward = true;
    const nextMessage = await tracker.process(
      messageInput({ messageId: "message-2", content: "A fresh message" }),
    );

    assert.equal(duplicateEvent.reason, "duplicate_event");
    assert.equal(nextMessage.awarded, true);
  });
});
