import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageType, type GuildMember, type Message } from "discord.js";

import {
  createAfkMentionNotice,
  createAfkNickname,
  handleAfkMessage,
  isAfkCommand,
  parseAfkCommand,
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
      },
    },
  } as unknown as Message;
}

describe("AFK listener", () => {
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
