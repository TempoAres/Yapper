import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelType, Collection, MessageType, PermissionFlagsBits, PermissionsBitField, type Guild, type Message } from "discord.js";
import { collectAnalysisHistory, collectChannelHistory, type AnalysisHistory, type HistoryChannel } from "../src/services/analyze/history.js";
import { DiscordAnalysisService } from "../src/services/analyze/analysis-service.js";

const endsAt = new Date("2026-11-11T12:00:00Z");
const startedAt = new Date("2026-10-12T12:00:00Z");
function history(): AnalysisHistory {
  return { startedAt, endsAt, messages: [], scannedChannels: 0, skippedChannels: 0, failedChannels: 0, threadDiscoveryFailures: 0 };
}
function message(id: string, authorId: string, date = "2026-11-01T12:00:00Z", extra: Record<string, unknown> = {}): Message {
  return {
    id, guildId: "guild", channelId: "channel", createdAt: new Date(date),
    author: { id: authorId, bot: false }, content: `text-${id}`, type: MessageType.Default,
    webhookId: null, system: false, attachments: new Collection(), stickers: new Collection(), ...extra,
  } as unknown as Message;
}
function channel(pages: Message[][], references = new Map<string, Message>()) {
  const requests: Array<Record<string, unknown>> = [];
  const source = {
    id: "channel", guild: { id: "guild" },
    messages: {
      fetch: async (options: Record<string, unknown>) => {
        requests.push(options);
        if (options.message) {
          const reference = references.get(String(options.message));
          if (!reference) throw new Error("Deleted reply");
          return reference;
        }
        return new Collection((pages.shift() ?? []).map((entry) => [entry.id, entry]));
      },
    },
  } as unknown as HistoryChannel;
  return { source, requests };
}

describe("analysis history", () => {
  it("keeps the nearest other human across pages, including just before the window", async () => {
    const { source, requests } = channel([
      [message("10", "target"), message("9", "target", "2026-10-12T12:00:00Z")],
      [message("8", "target", "2026-10-12T11:59:00Z"), message("7", "other", "2026-10-12T11:58:00Z", { author: { id: "bot", bot: true } }), message("6", "other", "2026-10-12T11:57:00Z")],
    ]);
    const result = history();
    await collectChannelHistory(source, "target", result);
    assert.deepEqual(result.messages.map((entry) => entry.id), ["10", "9"]);
    assert.deepEqual(result.messages.map((entry) => entry.context?.content), ["text-6", "text-6"]);
    assert.equal(requests[1]?.before, "9");
    assert.ok(requests.every((request) => request.cache === false));
  });

  it("prefers a direct reply, falls back for deleted or self replies, and excludes the exclusive end", async () => {
    const { source } = channel([[
      message("20", "target", endsAt.toISOString()),
      message("19", "target", undefined, { reference: { messageId: "5" } }),
      message("18", "target", undefined, { reference: { messageId: "missing" } }),
      message("17", "target", undefined, { reference: { messageId: "4" } }),
      message("16", "other"),
      message("1", "other", "2026-10-01T12:00:00Z"),
    ]], new Map([["5", message("5", "other")], ["4", message("4", "target")]]));
    const result = history();
    await collectChannelHistory(source, "target", result);
    assert.deepEqual(result.messages.map((entry) => entry.id), ["19", "18", "17"]);
    assert.deepEqual(result.messages.map((entry) => entry.context?.kind), ["reply", "preceding", "preceding"]);
    assert.deepEqual(result.messages.map((entry) => entry.context?.content), ["text-5", "text-16", "text-16"]);
  });

  it("does not fetch foreign-channel reply references or invent context", async () => {
    const { source, requests } = channel([[message("20", "target", undefined, {
      reference: { messageId: "secret", channelId: "foreign-channel", guildId: "foreign-guild" },
    })], []]);
    const result = history();
    await collectChannelHistory(source, "target", result);
    assert.equal(result.messages[0]?.context, undefined);
    assert.equal(requests.some((request) => request.message), false);
  });

  it("deduplicates overlapping pages and stops stalled pagination", async () => {
    const { source } = channel([[message("10", "target")], [message("10", "target")]]);
    const result = history();
    await assert.rejects(collectChannelHistory(source, "target", result), /did not advance/);
    assert.equal(result.messages.length, 1);
  });

  it("discovers paginated archives, deduplicates active threads, and reports failed coverage", async () => {
    const permissions = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
    ]);
    const scanned: string[] = [];
    const archiveRequests: Array<Record<string, unknown>> = [];
    const base = (id: string, readable = true) => ({
      id, guild: { id: "guild" }, type: ChannelType.GuildText,
      permissionsFor: () => readable ? permissions : new PermissionsBitField(),
      messages: { fetch: async () => { scanned.push(id); return new Collection(); } },
    });
    const archived = (id: string) => ({ ...base(id), archiveTimestamp: endsAt.getTime(), archivedAt: endsAt });
    const thread1 = archived("100");
    const thread2 = archived("99");
    let publicPage = 0;
    let privatePage = 0;
    const parent = { ...base("parent"), threads: {
      fetchArchived: async (options: Record<string, unknown>) => {
        archiveRequests.push(options);
        if (options.type === "private") {
          privatePage++;
          return { threads: new Collection([[privatePage === 1 ? "100" : "99", privatePage === 1 ? thread1 : thread2]]), hasMore: privatePage === 1 };
        }
        publicPage++;
        return { threads: new Collection([[publicPage === 1 ? "100" : "99", publicPage === 1 ? thread1 : thread2]]), hasMore: publicPage === 1 };
      },
    } };
    const broken = { ...base("broken"), messages: { fetch: async () => { throw new Error("Forbidden"); } } };
    const forum = { ...base("forum"), type: ChannelType.GuildForum, messages: undefined, threads: {
      fetchArchived: async () => { throw new Error("Listing failed"); },
    } };
    // Real forums have no messages property.
    delete (forum as { messages?: unknown }).messages;
    const guild = {
      id: "guild", members: { fetchMe: async () => ({ id: "bot" }) },
      channels: {
        fetch: async () => new Collection<string, unknown>([["parent", parent], ["hidden", base("hidden", false)], ["broken", broken], ["forum", forum]]),
        fetchActiveThreads: async () => ({ threads: new Collection([["100", thread1]]) }),
      },
    } as unknown as Guild;
    const result = await collectAnalysisHistory(guild, "target", endsAt);
    assert.equal(result.startedAt.toISOString(), startedAt.toISOString());
    assert.deepEqual(scanned.sort(), ["100", "99", "parent"]);
    assert.equal(result.scannedChannels, 3);
    assert.equal(result.skippedChannels, 1);
    assert.equal(result.failedChannels, 1);
    assert.equal(result.threadDiscoveryFailures, 1);
    assert.equal(archiveRequests[1]?.before instanceof Date, true);
    assert.equal(archiveRequests[3]?.before, "100");
    assert.equal(archiveRequests[2]?.fetchAll, false);
  });

  it("does not call OpenAI for empty history", async () => {
    const guild = {
      members: { fetchMe: async () => ({}) },
      channels: { fetch: async () => new Collection(), fetchActiveThreads: async () => ({ threads: new Collection() }) },
    } as unknown as Guild;
    const service = new DiscordAnalysisService({ summarize: async () => { throw new Error("Must not run"); } });
    const result = await service.analyze(guild, "target");
    assert.equal(result.summary, undefined);
    assert.equal(result.history.messages.length, 0);
  });
});
