import assert from "node:assert/strict";
import { test } from "node:test";
import { Games, categories } from "../src/services/games/games.js";
import { gameCommand, gamesCommand } from "../src/commands/games.js";
const create = () =>
  new Games(
    new Set(["apple", "elephant", "tiger", "rabbit", "tree", "egg"]),
    () => 0,
  );
test("commands expose /games and all four start/stop groups", () => {
  assert.equal(gamesCommand.data.name, "games");
  const data = gameCommand.data.toJSON();
  assert.equal(data.name, "game");
  assert.equal(data.default_member_permissions, null);
  assert.equal(gamesCommand.data.toJSON().default_member_permissions, null);
  assert.deepEqual(
    data.options?.map((g) => g.name),
    ["wordchain", "categories", "counting", "higherlower"],
  );
  for (const group of data.options ?? []) {
    assert.ok("options" in group);
    assert.deepEqual(
      group.options?.map((s) => s.name),
      group.name === "higherlower" ? ["start", "stop", "leaderboard"] : ["start", "stop"],
    );
  }
});
test("sessions isolate channels and prevent replacing an active game", () => {
  const g = create();
  g.start("a", "counting", "u", 0);
  g.start("b", "wordchain", "v", 0);
  assert.match(g.start("a", "categories", "u", 0), /already playing counting/);
  assert.equal(g.message("a", "u", "1", 1)?.score, 1);
  assert.equal(g.message("b", "v", "elephant", 1)?.score, 1);
  assert.equal(g.message("other", "u", "1", 1), undefined);
});
test("word chain validates dictionary, initial letter, repeats, and turn order without breaking chain", () => {
  const g = create();
  g.start("a", "wordchain", "u", 0);
  assert.equal(g.message("a", "u", "zzzz", 1)?.reaction, "❌");
  assert.equal(g.message("a", "u", "tiger", 2)?.reaction, "❌");
  assert.equal(g.message("a", "u", "Elephant", 3)?.score, 1);
  assert.equal(g.message("a", "u", "tiger", 4)?.reaction, "⏳");
  assert.equal(g.message("a", "v", "tiger", 5)?.score, 2);
  assert.equal(g.message("a", "u", "elephant", 6)?.reaction, "🔁");
  assert.equal(g.message("a", "u", "rabbit", 7)?.score, 3);
});
test("counting replaces multiples of five and resets wrong numbers and consecutive turns", () => {
  const g = create();
  g.start("a", "counting", "u", 0);
  for (let n = 1; n <= 10; n++)
    assert.equal(
      g.message("a", String(n % 2), n % 5 ? String(n) : "yap", n)?.score,
      n,
    );
  assert.equal(g.message("a", "u", "ordinary chat", 11), undefined);
  assert.equal(g.message("a", "u", "12", 12)?.reaction, "❌");
  assert.equal(g.message("a", "u", "1", 13)?.score, 1);
  assert.equal(g.message("a", "u", "2", 14)?.reaction, "❌");
  assert.equal(g.message("a", "v", "1", 15)?.score, 1);
});
test("category rush scores unique curated answers and expires exactly at deadline", () => {
  const g = create();
  g.start("a", "categories", "u", 0);
  assert.equal(g.message("a", "u", "RED", 1)?.score, 1);
  assert.equal(g.message("a", "v", "red", 2)?.reaction, "🔁");
  assert.equal(g.message("a", "u", "grey", 3)?.score, 2);
  assert.equal(g.message("a", "v", "gray", 4)?.reaction, "🔁");
  assert.equal(g.message("a", "v", "not a colour", 5), undefined);
  assert.equal(g.message("a", "u", "blue", 59_999)?.score, 3);
  assert.match(
    g.message("a", "v", "green", 60_000)!.text,
    /Shared score: \*\*3/,
  );
  assert.equal(g.active("a"), undefined);
});
test("any member can stop a game; stop matches the game and releases the channel", () => {
  const g = create();
  g.start("a", "counting", "owner", 0);
  assert.match(g.stop("a", "wordchain"), /not running/);
  assert.equal(g.active("a"), "counting");
  assert.match(g.stop("a", "counting"), /stopped/);
  assert.equal(g.active("a"), undefined);
  g.start("a", "categories", "owner", 0);
  assert.match(g.stop("a", "categories"), /stopped/);
});
test("inactivity expiry, refresh on valid turns, and monotonic records", () => {
  const g = create();
  g.start("a", "counting", "u", 0);
  g.message("a", "u", "1", 1000);
  assert.equal(g.expire("a", 1_800_000), undefined);
  assert.equal(g.expire("a", 1_801_000)?.score, 1);
  g.remember("a", "counting", 10);
  g.remember("a", "counting", 3);
  assert.equal(g.best("a", "counting"), 10);
  assert.equal(g.best("b", "counting"), 0);
});


test("higher/lower reacts toward the secret, ignores invalid guesses, and ends on a win", () => {
  const g = new Games(new Set(), () => 0.4999);
  assert.match(g.start("a", "higherlower", "owner", 0), /1 to 10,000/);
  for (const invalid of ["ordinary chat", "0", "10001", "-1", "1.5", "1e3", "9999999999999999"])
    assert.equal(g.message("a", "u", invalid, 1), undefined);
  assert.equal(g.message("a", "u", "1", 2)?.reaction, "⬆️");
  assert.equal(g.message("a", "u", "10000", 3)?.reaction, "⬇️");
  assert.equal(g.message("a", "u", "4998", 4)?.text, "");
  const won = g.message("a", "u", " 5000 ", 5)!;
  assert.equal(won.reaction, "✅");
  assert.equal(won.completed, true);
  assert.match(won.text, /5000.*4.*guesses/);
  assert.equal(won.score, 0);
  assert.equal(g.active("a"), undefined);
  assert.equal(g.message("a", "u", "5000", 6), undefined);
});

test("higher/lower includes both endpoints and expires after valid-guess inactivity", () => {
  for (const [random, target] of [[0, 1], [0.999999, 10000]] as const) {
    const g = new Games(new Set(), () => random);
    g.start("a", "higherlower", "owner", 0);
    assert.match(g.message("a", "u", String(target), 1)!.text, /1.*guess!/);
  }
  const g = create();
  g.start("a", "higherlower", "owner", 0);
  g.message("a", "u", "2", 1000);
  assert.equal(g.expire("a", 1_800_000), undefined);
  g.message("a", "u", "hello", 1_800_999);
  assert.match(g.expire("a", 1_801_000)!.text, /expired/);
  g.start("a", "higherlower", "owner", 1_801_001);
  assert.equal(g.active("a"), "higherlower");
});

test("higher/lower leaderboard displays legacy wins without starting or stopping a round", async () => {
  const { formatHigherLowerLeaderboard } = await import("../src/services/games/higherlower-wins.js");
  const g = create();
  g.start("a", "higherlower", "owner");
  const session = g.sessionToken("a");
  const board = { totalWins: 923, legacyWins: 922, channels: [{ channelId: "123", wins: 1 }] };
  let reply: { content?: string; allowedMentions?: unknown } | undefined;
  await gameCommand.execute({
    inGuild: () => true,
    guildId: "server",
    channelId: "a",
    channel: { isSendable: () => true, isThread: () => false },
    guild: { members: { me: { permissionsIn: () => ({ has: () => true }) } } },
    options: { getSubcommandGroup: () => "higherlower", getSubcommand: () => "leaderboard" },
    async deferReply() {},
    async editReply(value: typeof reply) { reply = value; },
  } as unknown as Parameters<typeof gameCommand.execute>[0], {
    games: g,
    higherLowerWins: {
      async leaderboard(guildId: string) {
        assert.equal(guildId, "server");
        return board;
      },
    },
  } as unknown as Parameters<typeof gameCommand.execute>[1]);
  assert.match(reply?.content ?? "", /Total completed games: \*\*923/);
  assert.match(reply?.content ?? "", /previous bot: \*\*922/);
  assert.match(reply?.content ?? "", /1\. <#123> — \*\*1/);
  assert.deepEqual(reply?.allowedMentions, { parse: [] });
  assert.equal(g.sessionToken("a"), session);
  assert.match(formatHigherLowerLeaderboard({ totalWins: 922, legacyWins: 922, channels: [] }), /No new completed games yet/);
});

test("ordinary members can stop another member's round and use /games", async () => {
  const g = create();
  g.start("a", "higherlower", "owner");
  const replies: string[] = [];
  const interaction = {
    inGuild: () => true,
    channelId: "a",
    user: { id: "other-member" },
    memberPermissions: { has: () => false },
    channel: { isSendable: () => true, isThread: () => false },
    guild: { members: { me: { permissionsIn: () => ({ has: () => true }) } } },
    options: { getSubcommandGroup: () => "higherlower", getSubcommand: () => "stop" },
    async deferReply() {},
    async editReply(value: { content: string }) { replies.push(value.content); },
    async reply(value: { content: string }) { replies.push(value.content); },
  } as unknown as Parameters<typeof gameCommand.execute>[0];
  const context = { games: g } as Parameters<typeof gameCommand.execute>[1];
  await gameCommand.execute(interaction, context);
  assert.equal(g.active("a"), undefined);
  assert.match(replies[0]!, /higherlower stopped/);
  await gamesCommand.execute(interaction, context);
  assert.match(replies[1]!, /Anyone can start or stop a game/);
});


test("counting confirms valid numbers and yap with reactions only", () => {
  const g = create();
  g.start("a", "counting", "owner", 0);
  for (let number = 1; number <= 6; number++) {
    const result = g.message("a", String(number % 2), number === 5 ? "yap" : String(number), number)!;
    assert.equal(result.text, "");
    assert.equal(result.reaction, "✅");
    assert.equal(result.score, number);
  }
  assert.equal(g.message("a", "other", "9", 7)?.reaction, "❌");
});

test("all twelve category themes are selectable and accept multi-word answers", () => {
  assert.equal(categories.length, 12);
  for (const [index, category] of categories.entries()) {
    const g = new Games(new Set(), () => (index + 0.5) / categories.length);
    assert.ok(g.start("a", "categories", "owner", 0).includes(category.name));
    const answer = category.answers.find(a => a.includes(" ")) ?? category.answers[0];
    assert.equal(g.message("a", "u", ` ${answer.toUpperCase()} `, 1)?.score, 1);
    assert.equal(g.message("a", "u", answer, 2)?.reaction, "🔁");
    assert.equal(g.message("a", "u", "not an accepted answer", 3), undefined);
  }
});

test("/games acknowledges publicly then lists every category within Discord's message limit", async () => {
  let acknowledged = false;
  await gamesCommand.execute({
    async deferReply(options: unknown) {
      assert.equal(options, undefined);
      acknowledged = true;
    },
    async editReply(reply: {content: string; allowedMentions: unknown}) {
      assert.equal(acknowledged, true);
      assert.ok(reply.content.length < 2000);
      for (const category of categories) assert.ok(reply.content.includes(category.name));
      assert.deepEqual(reply.allowedMentions, {parse: []});
    },
  } as unknown as Parameters<typeof gamesCommand.execute>[0], {} as Parameters<typeof gamesCommand.execute>[1]);
});

test("Minecraft blocks accepts every Java 26.3 registry ID and English name", async () => {
  const { minecraftBlockNames } = await import("../src/services/games/minecraft-blocks-data.js");
  const { minecraftBlockKey, minecraftBlockCount, minecraftVersion } = await import("../src/services/games/minecraft-blocks.js");
  assert.equal(minecraftVersion, "26.3");
  assert.equal(minecraftBlockCount, 1286);
  for (const [id, name] of Object.entries(minecraftBlockNames)) {
    assert.equal(minecraftBlockKey(id), id);
    assert.equal(minecraftBlockKey(name), id);
    assert.equal(minecraftBlockKey(`minecraft:${id}`), id);
  }
  assert.equal(minecraftBlockKey("diamond"), undefined);
  assert.equal(minecraftBlockKey("not a real block"), undefined);
});

test("Minecraft category start explains spaces; Ice and Blue Ice score separately but aliases do not", () => {
  const index = categories.findIndex(category => category.name === "Minecraft blocks");
  const g = new Games(new Set(), () => (index + 0.5) / categories.length);
  const start = g.start("a", "categories", "owner", 0);
  assert.match(start, /Minecraft Java 26\.3/);
  assert.match(start, /Blue Ice.*Ice.*separate messages/);
  assert.match(start, /Spaces or underscores/);
  assert.equal(g.message("a", "u", "Blue Ice", 1)?.score, 1);
  assert.equal(g.message("a", "u", "blue_ice", 2)?.reaction, "🔁");
  assert.equal(g.message("a", "u", "Ice", 3)?.score, 2);
  assert.equal(g.message("a", "u", "ice", 4)?.reaction, "🔁");
  assert.equal(g.message("a", "u", "  Smooth   Stone  ", 5)?.score, 3);
  assert.equal(g.message("a", "u", "minecraft:smooth_stone", 6)?.reaction, "🔁");
  assert.equal(g.message("a", "u", "Stone", 7)?.score, 4);
  assert.equal(g.message("a", "u", "diamond", 8), undefined);
});


test("every category lasts exactly 60 seconds and normalizes multi-word answers", () => {
  for (const [index, category] of categories.entries()) {
    const g = new Games(new Set(), () => (index + 0.5) / categories.length);
    assert.match(g.start("a", "categories", "owner", 0), /60 seconds/);
    const answer = category.answers.find(a => a.includes(" ")) ?? category.answers[0];
    assert.equal(g.message("a", "u", answer.toUpperCase().replace(/ /g, "   "), 30_000)?.reaction, "✅");
    assert.equal(g.message("a", "v", answer.replace(/ /g, "_"), 59_999)?.reaction, "🔁");
    assert.equal(g.expire("a", 59_999), undefined);
    assert.match(g.expire("a", 60_000)!.text, /Shared score: \*\*1/);
    assert.equal(g.expire("a", 60_001), undefined);
  }
});

test("Minecraft mobs accepts Wither skeleton with spaces and prevents alias duplicates", () => {
  const index = categories.findIndex(c => c.name === "Minecraft mobs");
  const g = new Games(new Set(), () => (index + 0.5) / categories.length);
  assert.match(g.start("a", "categories", "owner", 0), /Wither skeleton/);
  const result = g.message("a", "u", " Wither   skeleton ", 1)!;
  assert.equal(result.score, 1);
  assert.equal(result.text, "");
  assert.equal(result.reaction, "✅");
  assert.equal(g.message("a", "v", "WITHER_SKELETON", 2)?.reaction, "🔁");
  assert.equal(g.message("a", "v", "skeleton", 3)?.score, 2);
});

test("counting final summary keeps the best streak after a reset", () => {
  for (const stop of [false, true]) {
    const g = create();
    g.start("a", "counting", "owner", 0);
    g.message("a", "u", "1", 1);
    g.message("a", "v", "2", 2);
    assert.equal(g.message("a", "u", "4", 3)?.text, "");
    const text = stop ? g.stop("a", "counting") : g.expire("a", 1_800_002)!.text;
    assert.match(text, /Best streak: \*\*2/);
  }
});

test("all games require reaction permissions before starting", async () => {
  for (const game of ["wordchain", "categories", "counting", "higherlower"] as const) {
    const g = create();
    let reply = "";
    await gameCommand.execute({
      inGuild: () => true,
      channelId: "a",
      channel: { isSendable: () => true, isThread: () => false },
      guild: { members: { me: { permissionsIn: () => ({ has: (bits: bigint[]) => !bits.includes(64n) }) } } },
      options: { getSubcommandGroup: () => game, getSubcommand: () => "start" },
      async reply(value: { content: string }) { reply = value.content; },
    } as unknown as Parameters<typeof gameCommand.execute>[0], { games: g } as Parameters<typeof gameCommand.execute>[1]);
    assert.match(reply, /Add Reactions and Read Message History/);
    assert.equal(g.active("a"), undefined);
  }
});
