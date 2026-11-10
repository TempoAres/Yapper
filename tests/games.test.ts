import assert from "node:assert/strict";
import { test } from "node:test";
import { Games } from "../src/services/games/games.js";
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
  assert.match(g.message("a", "u", "zzzz", 1)!.text, /dictionary/);
  assert.match(g.message("a", "u", "tiger", 2)!.text, /start with/);
  assert.equal(g.message("a", "u", "Elephant", 3)?.score, 1);
  assert.match(g.message("a", "u", "tiger", 4)!.text, /another player/);
  assert.equal(g.message("a", "v", "tiger", 5)?.score, 2);
  assert.match(g.message("a", "u", "elephant", 6)!.text, /already/);
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
  assert.match(g.message("a", "u", "12", 12)!.text, /Expected \*\*11/);
  assert.equal(g.message("a", "u", "1", 13)?.score, 1);
  assert.match(g.message("a", "u", "2", 14)!.text, /Take turns/);
  assert.equal(g.message("a", "v", "1", 15)?.score, 1);
});
test("category rush scores unique curated answers and expires exactly at deadline", () => {
  const g = create();
  g.start("a", "categories", "u", 0);
  assert.equal(g.message("a", "u", "RED", 1)?.score, 1);
  assert.equal(g.message("a", "v", "red", 2), undefined);
  assert.equal(g.message("a", "u", "grey", 3)?.score, 2);
  assert.equal(g.message("a", "v", "gray", 4), undefined);
  assert.equal(g.message("a", "v", "not a colour", 5), undefined);
  assert.equal(g.message("a", "u", "blue", 29_999)?.score, 3);
  assert.match(
    g.message("a", "v", "green", 30_000)!.text,
    /Shared score: \*\*3/,
  );
  assert.equal(g.active("a"), undefined);
});
test("stop requires starter or moderator, matches game, and releases channel", () => {
  const g = create();
  g.start("a", "counting", "owner", 0);
  assert.match(g.stop("a", "wordchain", "owner", false), /not running/);
  assert.match(g.stop("a", "counting", "other", false), /Only/);
  assert.equal(g.active("a"), "counting");
  assert.match(g.stop("a", "counting", "mod", true), /stopped/);
  assert.equal(g.active("a"), undefined);
  g.start("a", "categories", "owner", 0);
  assert.match(g.stop("a", "categories", "owner", false), /stopped/);
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
