import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageFlags, PermissionFlagsBits, PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";
import { analyzeCommand } from "../src/commands/analyze.js";
import type { CommandContext } from "../src/commands/command.js";
import type { AnalysisResult } from "../src/services/analyze/analysis-service.js";

function fixture() {
  const replies: Array<Record<string, unknown>> = [];
  const edits: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  const administrator = new PermissionsBitField(PermissionFlagsBits.Administrator);
  let calls = 0;
  const result: AnalysisResult = {
    history: {
      startedAt: new Date("2026-10-12T12:00:00Z"), endsAt: new Date("2026-11-11T12:00:00Z"),
      messages: [{ id: "1", channelId: "source", content: "Thanks!", createdAt: new Date() }],
      scannedChannels: 2, skippedChannels: 1, failedChannels: 0, threadDiscoveryFailures: 0,
    },
    summary: "Helpful, brief replies. @everyone <@123456789012345678>",
  };
  const guild = {
    id: "test-guild",
    members: {
      me: { id: "bot" },
      fetch: async ({ user }: { user: string }) => ({ id: user, displayName: "member", permissions: administrator }),
    },
  };
  const destination = {
    isThread: () => false, isSendable: () => true, isDMBased: () => false,
    permissionsFor: () => administrator,
    send: async (post: Record<string, unknown>) => { posts.push(post); },
  };
  const interaction = {
    guild, channel: destination, user: { id: "admin" }, memberPermissions: administrator,
    options: { getUser: () => ({ id: "target", bot: false }) },
    reply: async (reply: Record<string, unknown>) => { replies.push(reply); },
    deferReply: async (options: Record<string, unknown>) => { replies.push(options); },
    editReply: async (content: string) => { edits.push(content); },
  };
  const context = { analysisService: { analyze: async () => { calls++; return result; } } };
  const execute = () => analyzeCommand.execute(interaction as unknown as ChatInputCommandInteraction, context as unknown as CommandContext);
  return { interaction, context, guild, destination, replies, edits, posts, result, execute, calls: () => calls };
}

describe("analyze command", () => {
  it("registers an administrator-only guild command with a required user option", () => {
    const data = analyzeCommand.data.toJSON();
    assert.equal(data.name, "analyze");
    assert.equal(data.dm_permission, false);
    assert.equal(data.default_member_permissions, PermissionFlagsBits.Administrator.toString());
    assert.equal(data.options?.[0]?.name, "user");
    assert.equal(data.options?.[0]?.type, 6);
    assert.equal(data.options?.[0] && "required" in data.options[0] && data.options[0].required, true);
  });

  it("rejects non-administrators even if command permissions were overridden", async () => {
    const test = fixture();
    test.interaction.memberPermissions = new PermissionsBitField();
    await test.execute();
    assert.match(String(test.replies[0]?.content), /restricted to server administrators/);
    assert.equal(test.replies[0]?.flags, MessageFlags.Ephemeral);
    assert.equal(test.calls(), 0);
  });

  it("rejects DMs and unconfigured analysis before collecting anything", async () => {
    const dm = fixture();
    dm.interaction.guild = null as unknown as typeof dm.guild;
    await dm.execute();
    assert.equal(dm.calls(), 0);
    const unconfigured = fixture();
    delete (unconfigured.context as { analysisService?: unknown }).analysisService;
    await unconfigured.execute();
    assert.match(String(unconfigured.replies[0]?.content), /not configured/);
    assert.equal(unconfigured.calls(), 0);
  });

  it("rejects users outside the server and bot accounts", async () => {
    const outside = fixture();
    outside.guild.members.fetch = async () => { throw new Error("Unknown member"); };
    await outside.execute();
    assert.match(outside.edits.at(-1) ?? "", /currently a member/);
    assert.equal(outside.calls(), 0);
    const bot = fixture();
    bot.interaction.options.getUser = () => ({ id: "target", bot: true });
    await bot.execute();
    assert.equal(bot.calls(), 0);
    assert.match(bot.edits.at(-1) ?? "", /human server member/);
  });

  it("requires report-delivery permissions before incurring model costs", async () => {
    const test = fixture();
    test.destination.permissionsFor = () => new PermissionsBitField(PermissionFlagsBits.ViewChannel);
    await test.execute();
    assert.match(String(test.replies[0]?.content), /Embed Links/);
    assert.equal(test.calls(), 0);
  });

  it("posts the review in the invoking channel without notifications and with coverage", async () => {
    const test = fixture();
    await test.execute();
    assert.equal(test.replies[0]?.flags, MessageFlags.Ephemeral);
    assert.equal(test.posts.length, 1);
    assert.deepEqual(test.posts[0]?.allowedMentions, { parse: [] });
    assert.match(String(test.posts[0]?.content), /last 30 days/);
    assert.match(String(test.posts[0]?.content), /1 known channels unreadable/);
    assert.match(String(test.posts[0]?.content), /1 messages without context/);
    const embeds = test.posts[0]?.embeds as Array<{ toJSON(): { description: string } }>;
    assert.equal(embeds[0]?.toJSON().description, test.result.summary);
    assert.equal(test.calls(), 1);
  });

  it("still posts after a long-running interaction token expires", async () => {
    const test = fixture();
    const original = test.interaction.editReply;
    test.context.analysisService.analyze = async () => {
      test.interaction.editReply = async () => { throw new Error("Expired token"); };
      return test.result;
    };
    await test.execute();
    assert.equal(test.posts.length, 1);
    test.interaction.editReply = original;
  });

  it("does not post if membership or administrator permission is lost during analysis", async () => {
    for (const lost of ["admin", "target"]) {
      const test = fixture();
      test.context.analysisService.analyze = async () => {
        const original = test.guild.members.fetch;
        test.guild.members.fetch = async (options) => {
          if (options.user === lost) throw new Error("Member left");
          return original(options);
        };
        return test.result;
      };
      await test.execute();
      assert.equal(test.posts.length, 0);
      assert.match(test.edits.at(-1) ?? "", /cancelled/);
    }
  });

  it("prevents concurrent jobs in one server and releases the lock after a model failure", async () => {
    const first = fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    first.context.analysisService.analyze = async () => {
      started();
      await pending;
      throw new Error("Provider failure");
    };
    const running = first.execute();
    await entered;
    const second = fixture();
    await second.execute();
    assert.match(String(second.replies[0]?.content), /already running/);
    assert.equal(second.calls(), 0);
    release();
    await running;
    assert.match(first.edits.at(-1) ?? "", /could not be completed/);
    assert.equal(first.posts.length, 0);
    const next = fixture();
    await next.execute();
    assert.equal(next.posts.length, 1);
  });
});
