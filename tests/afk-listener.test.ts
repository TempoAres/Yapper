import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Collection, MessageType, type Client, type GuildMember, type Message } from "discord.js";

import { AfkEmojiResolver, formatAfkReason } from "../src/bot/afk-emojis.js";

import {
  AFK_WELCOME_DELETE_MILLISECONDS,
  createAfkMentionNotice,
  createAfkNickname,
  handleAfkMessage,
  isAfkCommand,
  parseAfkCommand,
  scheduleAfkWelcomeDeletion,
} from "../src/bot/afk-listener.js";
import {
  AFK_CLEAR_GRACE_MILLISECONDS,
  normalizeAfkReason,
  type AfkService,
  type AfkStatus,
  type SetAfkInput,
} from "../src/services/afk/afk-service.js";

class FakeAfkService implements AfkService {
  public readonly statuses = new Map<string, AfkStatus>();

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  public async setAfk(input: SetAfkInput): Promise<AfkStatus> {
    const status: AfkStatus = {
      ...input,
      reason: normalizeAfkReason(input.reason),
      clearAfter: new Date(
        input.setAt.getTime() + AFK_CLEAR_GRACE_MILLISECONDS,
      ),
    };
    this.statuses.set(this.key(input.guildId, input.userId), status);
    return status;
  }

  public async getAfk(
    guildId: string,
    userId: string,
  ): Promise<AfkStatus | undefined> {
    return this.statuses.get(this.key(guildId, userId));
  }

  public async getAfkForUsers(
    guildId: string,
    userIds: readonly string[],
  ): Promise<readonly AfkStatus[]> {
    return userIds.flatMap((userId) => {
      const status = this.statuses.get(this.key(guildId, userId));
      return status ? [status] : [];
    });
  }

  public async clearAfkIfReady(
    guildId: string,
    userId: string,
    now: Date,
  ): Promise<AfkStatus | undefined> {
    const key = this.key(guildId, userId);
    const status = this.statuses.get(key);

    if (!status || status.clearAfter.getTime() > now.getTime()) {
      return undefined;
    }

    this.statuses.delete(key);
    return status;
  }
}

function fakeMember(input: {
  nickname?: string | null;
  displayName?: string;
  manageable?: boolean;
  nicknameChanges: Array<string | null>;
}): GuildMember {
  let nickname = input.nickname ?? null;

  return {
    id: "user-1",
    guild: { id: "guild-1" },
    manageable: input.manageable ?? true,
    displayName: input.displayName ?? nickname ?? "Mika",
    get nickname() {
      return nickname;
    },
    setNickname: async (nextNickname: string | null) => {
      nickname = nextNickname;
      input.nicknameChanges.push(nextNickname);
      return undefined;
    },
  } as unknown as GuildMember;
}

function fakeMessage(input: {
  content: string;
  createdAt: Date;
  member: GuildMember;
  sent: unknown[];
  mentionedUserIds?: readonly string[];
}): Message {
  return {
    inGuild: () => true,
    author: { id: "user-1", bot: false },
    webhookId: null,
    system: false,
    type: MessageType.Default,
    content: input.content,
    guildId: "guild-1",
    channelId: "channel-1",
    id: `message-${input.createdAt.getTime()}`,
    createdAt: input.createdAt,
    member: input.member,
    mentions: {
      users: new Map(
        (input.mentionedUserIds ?? []).map((id) => [id, { id }]),
      ),
    },
    channel: {
      send: async (response: unknown) => {
        input.sent.push(response);
        return {
          id: `sent-${input.sent.length}`,
          delete: async () => undefined,
        };
      },
    },
  } as unknown as Message;
}

describe("AFK listener", () => {
  it("renders resolved emojis in confirmations and notices while saving the original reason", async () => {
    const service = new FakeAfkService();
    const sent: Array<unknown> = [];
    const original = "Sleeping <:bedge:123456789012345678>";
    const resolved = "Sleeping <:afk_123456789012345678:223456789012345678>";
    const resolver = {
      resolve: async (reason: string, guildId: string) => {
        assert.equal(reason, original);
        assert.equal(guildId, "guild-1");
        return resolved;
      },
    };
    const now = new Date("2026-09-29T12:00:00.000Z");
    await handleAfkMessage(fakeMessage({
      content: `?afk ${original}`, createdAt: now,
      member: fakeMember({ nicknameChanges: [] }), sent,
    }), service, resolver);
    assert.equal((await service.getAfk("guild-1", "user-1"))?.reason, original);
    assert.deepEqual(sent[0], {
      content: `You're now AFK: **${resolved}**`, allowedMentions: { parse: [] },
    });

    await service.setAfk({
      guildId: "guild-1", userId: "user-2", reason: original,
      setAt: now, originalNickname: null, appliedNickname: null,
    });
    await handleAfkMessage(fakeMessage({
      content: "<@user-2>", createdAt: now,
      member: fakeMember({ nicknameChanges: [] }), sent,
      mentionedUserIds: ["user-2"],
    }), service, resolver);
    assert.deepEqual(sent.at(-1), {
      content: `<@user-2> is AFK: **${resolved}** • since <t:${now.getTime() / 1_000}:R>`,
      allowedMentions: { parse: [] },
    });
  });

  it("recognizes only the ?afk prefix and defaults an empty reason", () => {
    assert.equal(isAfkCommand("?AFK lunch"), true);
    assert.equal(isAfkCommand("?afksoon"), false);
    assert.deepEqual(parseAfkCommand("?afk"), { reason: "AFK" });
    assert.deepEqual(parseAfkCommand("?afk   getting food   "), {
      reason: "getting food",
    });
  });

  it("creates a Discord-safe AFK nickname without stacking prefixes", () => {
    assert.equal(createAfkNickname("Mika"), "[AFK] Mika");
    assert.equal(createAfkNickname("[AFK] Mika"), "[AFK] Mika");
    assert.equal(
      [...createAfkNickname("A very long display name that needs trimming")]
        .length,
      32,
    );
  });

  it("deletes only a scheduled welcome-back message after 30 seconds", async () => {
    let scheduledCallback: (() => void) | undefined;
    let scheduledDelay: number | undefined;
    let unrefCalled = false;
    let deleted = false;

    scheduleAfkWelcomeDeletion(
      {
        id: "welcome-1",
        delete: async () => {
          deleted = true;
        },
      },
      (callback, delayMilliseconds) => {
        scheduledCallback = callback;
        scheduledDelay = delayMilliseconds;
        return {
          unref: () => {
            unrefCalled = true;
          },
        };
      },
    );

    assert.equal(scheduledDelay, AFK_WELCOME_DELETE_MILLISECONDS);
    assert.equal(unrefCalled, true);
    assert.equal(deleted, false);
    assert.ok(scheduledCallback);
    scheduledCallback();
    await Promise.resolve();
    assert.equal(deleted, true);
  });

  it("persists the reason and applies the AFK nickname", async () => {
    const service = new FakeAfkService();
    const sent: unknown[] = [];
    const nicknameChanges: Array<string | null> = [];
    const member = fakeMember({ nickname: "Tempo", nicknameChanges });
    const now = new Date("2026-09-29T12:00:00.000Z");

    assert.equal(
      await handleAfkMessage(
        fakeMessage({
          content: "?afk lunch",
          createdAt: now,
          member,
          sent,
        }),
        service,
      ),
      true,
    );

    assert.equal((await service.getAfk("guild-1", "user-1"))?.reason, "lunch");
    assert.deepEqual(nicknameChanges, ["[AFK] Tempo"]);
    assert.deepEqual(sent, [
      {
        content: "You're now AFK: **lunch**",
        allowedMentions: { parse: [] },
      },
    ]);
  });

  it("announces mentioned AFK members without pinging them again", async () => {
    const service = new FakeAfkService();
    const setAt = new Date("2026-09-29T10:00:00.000Z");
    await service.setAfk({
      guildId: "guild-1",
      userId: "user-2",
      reason: "sleeping",
      setAt,
      originalNickname: null,
      appliedNickname: null,
    });
    const response = createAfkMentionNotice(
      await service.getAfkForUsers("guild-1", ["user-2"]),
    );

    assert.deepEqual(response, {
      content: `<@user-2> is AFK: **sleeping** • since <t:${Math.floor(setAt.getTime() / 1_000)}:R>`,
      allowedMentions: { parse: [] },
    });
  });

  it("keeps AFK during the grace period, then clears it and restores the nickname", async () => {
    const service = new FakeAfkService();
    const sent: unknown[] = [];
    const nicknameChanges: Array<string | null> = [];
    const member = fakeMember({ nickname: "Tempo", nicknameChanges });
    const start = new Date("2026-09-29T12:00:00.000Z");

    await handleAfkMessage(
      fakeMessage({
        content: "?afk brb",
        createdAt: start,
        member,
        sent,
      }),
      service,
    );
    await handleAfkMessage(
      fakeMessage({
        content: "goodbye",
        createdAt: new Date(start.getTime() + 29_999),
        member,
        sent,
      }),
      service,
    );
    assert.ok(await service.getAfk("guild-1", "user-1"));

    await handleAfkMessage(
      fakeMessage({
        content: "I'm back",
        createdAt: new Date(start.getTime() + 30_000),
        member,
        sent,
      }),
      service,
    );

    assert.equal(await service.getAfk("guild-1", "user-1"), undefined);
    assert.deepEqual(nicknameChanges, ["[AFK] Tempo", "Tempo"]);
    assert.deepEqual(sent.at(-1), {
      content: "Welcome back, <@user-1>! I removed your AFK status.",
      allowedMentions: { parse: [], users: ["user-1"] },
    });
  });

  it("does not overwrite a nickname that was manually changed while AFK", async () => {
    const status: AfkStatus = {
      guildId: "guild-1",
      userId: "user-1",
      reason: "brb",
      setAt: new Date("2026-09-29T12:00:00.000Z"),
      clearAfter: new Date("2026-09-29T12:00:30.000Z"),
      originalNickname: "Tempo",
      appliedNickname: "[AFK] Tempo",
    };
    const service = new FakeAfkService();
    service.statuses.set("guild-1:user-1", status);
    const nicknameChanges: Array<string | null> = [];
    const member = fakeMember({
      nickname: "Manually changed",
      displayName: "Manually changed",
      nicknameChanges,
    });

    await handleAfkMessage(
      fakeMessage({
        content: "I'm back",
        createdAt: new Date("2026-09-29T12:01:00.000Z"),
        member,
        sent: [],
      }),
      service,
    );

    assert.deepEqual(nicknameChanges, []);
  });
});

function fakeEmoji(id: string, name: string, animated = false) {
  return { id, name, toString: () => `<${animated ? "a" : ""}:${name}:${id}>` };
}

function emojiClient(options: { existing?: ReturnType<typeof fakeEmoji>[]; fail?: boolean } = {}) {
  const cache = new Collection((options.existing ?? []).map((emoji) => [emoji.id, emoji]));
  const uploads: Array<{ name: string; attachment: string }> = [];
  let fetches = 0;
  const client = {
    guilds: { cache: new Collection() },
    emojis: { cache: new Collection<string, ReturnType<typeof fakeEmoji>>() },
    application: { emojis: {
      cache,
      fetch: async () => { fetches++; return cache; },
      create: async (input: { name: string; attachment: string }) => {
        uploads.push(input);
        if (options.fail) throw new Error("Upload unavailable");
        const emoji = fakeEmoji(`22345678901234567${uploads.length}`, input.name, input.attachment.includes(".gif"));
        cache.set(emoji.id, emoji);
        return emoji;
      },
    } },
  };
  return { client: client as unknown as Client, uploads, fetches: () => fetches };
}

describe("AFK emojis", () => {
  it("keeps Unicode and custom markup intact while escaping surrounding Markdown", () => {
    assert.equal(
      formatAfkReason("**Sleeping** 😴 <:bed__ge:123456789012345678> <a:zzz:123456789012345679>"),
      "\\*\\*Sleeping\\*\\* 😴 <:bed__ge:123456789012345678> <a:zzz:123456789012345679>",
    );
  });

  it("does not call Discord for plain text, Unicode, or an unknown shorthand", async () => {
    const fake = emojiClient();
    assert.equal(await new AfkEmojiResolver(fake.client).resolve("Sleeping 😴 :unknown:", "guild-1"), "Sleeping 😴 :unknown:");
    assert.equal(fake.fetches(), 0);
  });

  it("bounds long expanded reasons without breaking emoji markup or Discord's message limit", () => {
    const emoji = "<:afk_123456789012345678:223456789012345678>";
    const formatted = formatAfkReason(emoji.repeat(75));
    assert.ok(formatted.length <= 1_500);
    assert.ok(formatted.endsWith(`${emoji}…`));
    const setAt = new Date("2026-09-29T12:00:00.000Z");
    const notice = createAfkMentionNotice([{
      guildId: "guild-1", userId: "user-2", reason: emoji.repeat(75),
      setAt, clearAfter: setAt, originalNickname: null, appliedNickname: null,
    }]);
    assert.ok(String(notice?.content).length < 2_000);
    assert.ok(String(notice?.content).includes(formatted));
  });

  it("imports static and animated emojis without membership in their source servers", async () => {
    const fake = emojiClient();
    const resolver = new AfkEmojiResolver(fake.client);
    assert.equal(await resolver.resolve("Sleeping <:bedge:123456789012345678> <a:zzz:123456789012345679>", "guild-1"),
      "Sleeping <:afk_123456789012345678:223456789012345671> <a:afk_123456789012345679:223456789012345672>");
    assert.deepEqual(fake.uploads, [
      { name: "afk_123456789012345678", attachment: "https://cdn.discordapp.com/emojis/123456789012345678.png?size=128" },
      { name: "afk_123456789012345679", attachment: "https://cdn.discordapp.com/emojis/123456789012345679.gif?size=128" },
    ]);
    assert.equal(fake.fetches(), 1);
  });

  it("reuses copies across restarts and concurrent requests, including already-resolved markup", async () => {
    const fake = emojiClient();
    const resolver = new AfkEmojiResolver(fake.client);
    const original = "<:bedge:123456789012345678>";
    const [first, second] = await Promise.all([
      resolver.resolve(original, "guild-1"), resolver.resolve(original, "guild-2"),
    ]);
    assert.equal(first, second);
    assert.equal(await new AfkEmojiResolver(fake.client).resolve(original, "guild-1"), first);
    assert.equal(await resolver.resolve(first, "guild-1"), first);
    assert.equal(fake.uploads.length, 1);
  });

  it("resolves a known shorthand, preferring the current server over another server", async () => {
    const fake = emojiClient();
    fake.client.emojis.cache.set("123456789012345679", fakeEmoji("123456789012345679", "bedge") as never);
    fake.client.guilds.cache.set("guild-1", {
      emojis: { cache: new Collection([["123456789012345678", fakeEmoji("123456789012345678", "bedge")]]) },
    } as never);
    const resolver = new AfkEmojiResolver(fake.client);
    await resolver.resolve("Sleeping :bedge:", "guild-1");
    await resolver.resolve("Sleeping :bedge:", "guild-2");
    assert.deepEqual(fake.uploads.map((upload) => upload.name), ["afk_123456789012345678", "afk_123456789012345679"]);
  });

  it("keeps AFK usable and avoids repeated uploads when an image is unavailable or slots are exhausted", async () => {
    const fake = emojiClient({ fail: true });
    const resolver = new AfkEmojiResolver(fake.client);
    const reason = "Sleeping <:bedge:123456789012345678>";
    assert.equal(await resolver.resolve(reason, "guild-1"), reason);
    assert.equal(await resolver.resolve(reason, "guild-1"), reason);
    assert.equal(fake.uploads.length, 1);
  });
});
