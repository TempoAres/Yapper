import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Events, type Client } from "discord.js";
import type { Pool } from "pg";
import { registerGames } from "../src/bot/games-listener.js";
import { Games } from "../src/services/games/games.js";

test(
  "listener ignores bots, serializes turns, persists records and reloads them",
  { timeout: 2000 },
  async () => {
    const rows = [{ channel_id: "a", game: "counting", score: 1 }];
    const writes: unknown[][] = [];
    const pool = {
      async query(sql: string, values?: unknown[]) {
        if (sql.startsWith("SELECT")) return { rows };
        writes.push(values!);
        rows[0]!.score = Number(values![2]);
        return { rows: [] };
      },
    } as unknown as Pool;
    const client = Object.assign(new EventEmitter(), {
      destroy() {},
      channels: { fetch: async () => null },
    }) as unknown as Client;
    const games = new Games(new Set());
    await registerGames(client, games, pool);
    try {
      assert.equal(games.best("a", "counting"), 1);
      games.start("a", "counting", "owner");
      const sent: string[] = [];
      let done!: () => void;
      const finished = new Promise<void>((resolve) => {
        done = resolve;
      });
      const message = (user: string, content: string, bot = false) => ({
        inGuild: () => true,
        author: { id: user, bot },
        webhookId: null,
        channelId: "a",
        guildId: "server",
        id: content,
        content,
        channel: {
          async send(options: {
            content: string;
            allowedMentions: { parse: string[] };
          }) {
            assert.deepEqual(options.allowedMentions.parse, []);
            sent.push(options.content);
            if (sent.length === 2) done();
          },
        },
      });
      (client as unknown as EventEmitter).emit(
        Events.MessageCreate,
        message("bot", "1", true),
      );
      (client as unknown as EventEmitter).emit(
        Events.MessageCreate,
        message("one", "1"),
      );
      (client as unknown as EventEmitter).emit(
        Events.MessageCreate,
        message("two", "2"),
      );
      await finished;
      assert.equal(sent.length, 2);
      assert.deepEqual(writes, [["a", "counting", 2]]);
      assert.match(sent[1]!, /New shared channel record/);
      // A queued turn from a stopped round must not enter a replacement round.
      (client as unknown as EventEmitter).emit(
        Events.MessageCreate,
        message("three", "3"),
      );
      games.stop("a", "counting", "owner", false);
      games.start("a", "counting", "owner");
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(sent.length, 2);

      const restored = new Games(new Set());
      const second = Object.assign(new EventEmitter(), {
        destroy() {},
      }) as unknown as Client;
      await registerGames(second, restored, pool);
      assert.equal(restored.best("a", "counting"), 2);
      assert.equal(restored.active("a"), undefined);
      await second.destroy();
    } finally {
      await client.destroy();
    }
  },
);


test("higher/lower listener reacts to guesses, persists one win and skips score records", { timeout: 2000 }, async () => {
  const writes: unknown[] = [];
  const pool = {
    async query(sql: string) {
      if (!sql.startsWith("SELECT")) writes.push(sql);
      return { rows: [] };
    },
  } as unknown as Pool;
  const client = Object.assign(new EventEmitter(), {
    destroy() {},
    channels: { fetch: async () => null },
  }) as unknown as Client;
  const games = new Games(new Set(), () => 0.4999);
  const winCredits: string[][] = [];
  const wins = {
    async record(...ids: string[]) { winCredits.push(ids); },
    async leaderboard() { return { totalWins: 923, legacyWins: 922, channels: [] }; },
  } as unknown as import("../src/services/games/higherlower-wins.js").HigherLowerWins;
  await registerGames(client, games, pool, wins);
  try {
    games.start("a", "higherlower", "owner");
    const reactions: string[] = [];
    const sent: string[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    for (const content of ["hi", "0", "1", "10000", "5000", "5000"])
      (client as unknown as EventEmitter).emit(Events.MessageCreate, {
        inGuild: () => true,
        author: { id: "one", bot: false },
        webhookId: null,
        channelId: "a",
        guildId: "server",
        id: content,
        content,
        async react(emoji: string) { reactions.push(emoji); },
        channel: {
          async send(options: { content: string }) {
            sent.push(options.content);
            done();
          },
        },
      });
    await finished;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(reactions, ["⬆️", "⬇️", "✅"]);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /5000.*3.*guesses/);
    assert.match(sent[0]!, /Total completed games: \*\*923/);
    assert.deepEqual(winCredits, [["server", "a", "5000"]]);
    assert.deepEqual(writes, []);
    assert.equal(games.active("a"), undefined);
  } finally {
    await client.destroy();
  }
});
