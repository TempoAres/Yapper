import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageType, type Message } from "discord.js";

import {
  extractMessageEmojiUsages,
  handleMessageEmojiUsage,
} from "../src/bot/message-emoji-listener.js";
import type {
  EmojiMessageUsageInput,
  EmojiService,
} from "../src/services/emoji/emoji-service.js";

class FakeEmojiService implements EmojiService {
  public readonly messages: EmojiMessageUsageInput[] = [];

  public async recordMessage(
    input: EmojiMessageUsageInput,
  ): Promise<{ recorded: number }> {
    this.messages.push(input);
    return {
      recorded: input.usages.reduce((sum, usage) => sum + usage.amount, 0),
    };
  }

  public async getLeaderboardPage(): Promise<never> {
    throw new Error("Not used.");
  }
}

function fakeMessage(content: string): Message {
  return {
    inGuild: () => true,
    author: { id: "user-1", bot: false },
    webhookId: null,
    system: false,
    type: MessageType.Default,
    content,
    guildId: "guild-1",
    channelId: "channel-1",
    id: "message-1",
    createdAt: new Date("2026-08-11T12:00:00.000Z"),
    guild: {
      emojis: {
        cache: new Map([["123456789012345678", { name: "party" }]]),
      },
    },
  } as unknown as Message;
}

describe("message emoji tracking", () => {
  it("counts Unicode graphemes and server-owned custom emojis", () => {
    assert.deepEqual(
      extractMessageEmojiUsages(
        "😀😀 👨‍👩‍👧‍👦 <:party:123456789012345678> <:party:123456789012345678>",
        new Set(["123456789012345678"]),
      ),
      [
        { emojiKey: "custom:123456789012345678", amount: 2 },
        { emojiKey: "unicode:👨‍👩‍👧‍👦", amount: 1 },
        { emojiKey: "unicode:😀", amount: 2 },
      ],
    );
  });

  it("excludes custom emojis that do not belong to the server", () => {
    assert.deepEqual(
      extractMessageEmojiUsages(
        "<:external:999999999999999999> <:party:123456789012345678>",
        new Set(["123456789012345678"]),
      ),
      [{ emojiKey: "custom:123456789012345678", amount: 1 }],
    );
  });

  it("records only IDs, keys, counts, and message metadata", async () => {
    const service = new FakeEmojiService();
    const recorded = await handleMessageEmojiUsage(
      fakeMessage("Hello 😀 <:party:123456789012345678>"),
      service,
    );

    assert.equal(recorded, 2);
    assert.equal(service.messages.length, 1);
    assert.deepEqual(service.messages[0]?.usages, [
      { emojiKey: "custom:123456789012345678", amount: 1 },
      { emojiKey: "unicode:😀", amount: 1 },
    ]);
    assert.equal("content" in (service.messages[0] ?? {}), false);
  });
});
