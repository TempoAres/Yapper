import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createReactionEmojiKey } from "../src/bot/reaction-listener.js";
import { ReactionTracker } from "../src/services/reactions/reaction-tracker.js";
import type {
  AddReactionInput,
  ReactionMembershipInput,
  ReactionService,
} from "../src/services/reactions/reaction-service.js";

function createFakeService() {
  const added: AddReactionInput[] = [];
  const removed: ReactionMembershipInput[] = [];
  const cleared: Array<{
    guildId: string;
    messageId: string;
    emojiKey?: string;
  }> = [];
  const service: ReactionService = {
    async addReaction(input) {
      added.push(input);
      return { applied: true };
    },
    async removeReaction(input) {
      removed.push(input);
      return { applied: true };
    },
    async clearReactions(input) {
      cleared.push(input);
      return { removedCount: 2 };
    },
    async getLeaderboardPage(input) {
      return {
        metric: input.metric,
        page: input.page,
        pageSize: 10,
        totalPages: 1,
        participantCount: 0,
        visibleEntryCount: 0,
        entries: [],
        generatedAt: input.now,
      };
    },
  };

  return { service, added, removed, cleared };
}

const baseAdd = {
  guildId: "939811280657719327",
  messageId: "1534576595145199818",
  emojiKey: "unicode:\u2764\uFE0F",
  reactorUserId: "939644859092992060",
  messageAuthorId: "153452985728578777",
  reactorIsBot: false,
  messageAuthorIsBot: false,
  createdAt: new Date("2026-08-11T12:00:00.000Z"),
} as const;

describe("reaction tracker", () => {
  it("records eligible reactions without storing message content", async () => {
    const fake = createFakeService();
    const tracker = new ReactionTracker(fake.service);

    assert.deepEqual(await tracker.add(baseAdd), { applied: true });
    assert.deepEqual(fake.added, [
      {
        guildId: baseAdd.guildId,
        messageId: baseAdd.messageId,
        emojiKey: baseAdd.emojiKey,
        reactorUserId: baseAdd.reactorUserId,
        messageAuthorId: baseAdd.messageAuthorId,
        createdAt: baseAdd.createdAt,
      },
    ]);
  });

  it("ignores bot and self reactions", async () => {
    const fake = createFakeService();
    const tracker = new ReactionTracker(fake.service);

    assert.deepEqual(
      await tracker.add({ ...baseAdd, reactorIsBot: true }),
      { applied: false },
    );
    assert.deepEqual(
      await tracker.add({
        ...baseAdd,
        reactorUserId: baseAdd.messageAuthorId,
      }),
      { applied: false },
    );
    assert.deepEqual(
      await tracker.add({ ...baseAdd, messageAuthorIsBot: true }),
      { applied: false },
    );
    assert.equal(fake.added.length, 0);
  });

  it("delegates removals only for human reactors", async () => {
    const fake = createFakeService();
    const tracker = new ReactionTracker(fake.service);
    const removeInput = {
      guildId: baseAdd.guildId,
      messageId: baseAdd.messageId,
      emojiKey: baseAdd.emojiKey,
      reactorUserId: baseAdd.reactorUserId,
      reactorIsBot: false,
    } as const;

    assert.deepEqual(await tracker.remove(removeInput), { applied: true });
    assert.deepEqual(
      await tracker.remove({ ...removeInput, reactorIsBot: true }),
      { applied: false },
    );
    assert.deepEqual(fake.removed, [
      {
        guildId: removeInput.guildId,
        messageId: removeInput.messageId,
        emojiKey: removeInput.emojiKey,
        reactorUserId: removeInput.reactorUserId,
      },
    ]);
  });

  it("delegates message and emoji cleanup", async () => {
    const fake = createFakeService();
    const tracker = new ReactionTracker(fake.service);
    const input = {
      guildId: baseAdd.guildId,
      messageId: baseAdd.messageId,
      emojiKey: baseAdd.emojiKey,
    };

    assert.deepEqual(await tracker.clear(input), { removedCount: 2 });
    assert.deepEqual(fake.cleared, [input]);
  });

  it("creates stable keys for custom and Unicode emoji", () => {
    assert.equal(
      createReactionEmojiKey({ id: "123456789012345678", name: "party" }),
      "custom:123456789012345678",
    );
    assert.equal(
      createReactionEmojiKey({ id: null, name: "\uD83C\uDF89" }),
      "unicode:\uD83C\uDF89",
    );
  });
});
