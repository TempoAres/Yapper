import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMee6ImportCsv,
  fetchMee6Leaderboard,
  type Mee6FetchFunction,
} from "../src/services/imports/mee6-fetcher.js";

const GUILD_ID = "939811280657719327";
const USER_ONE = "123456789012345678";
const USER_TWO = "234567890123456789";
const USER_THREE = "345678901234567890";

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  const init: ResponseInit = { status };

  if (headers !== undefined) {
    init.headers = headers;
  }

  return new Response(JSON.stringify(value), init);
}

function leaderboardPage(players: Array<{ id: string; xp: number | string }>): unknown {
  return {
    guild: { id: GUILD_ID, name: "Bluddington" },
    players,
  };
}

describe("fetchMee6Leaderboard", () => {
  it("paginates until a short page and keeps only IDs plus raw XP", async () => {
    const requestedPages: number[] = [];
    const fetchImpl: Mee6FetchFunction = async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      return jsonResponse(
        leaderboardPage(
          page === 0
            ? [
                { id: USER_ONE, xp: 100 },
                { id: USER_TWO, xp: "50" },
              ]
            : [{ id: USER_THREE, xp: 25 }],
        ),
      );
    };

    const result = await fetchMee6Leaderboard({
      guildId: GUILD_ID,
      pageSize: 2,
      pageDelayMilliseconds: 0,
      fetchImpl,
    });

    assert.deepEqual(requestedPages, [0, 1]);
    assert.equal(result.guildName, "Bluddington");
    assert.equal(result.pagesFetched, 2);
    assert.deepEqual(result.rows, [
      { userId: USER_ONE, rawXp: 100 },
      { userId: USER_TWO, rawXp: 50 },
      { userId: USER_THREE, rawXp: 25 },
    ]);
    assert.equal(
      buildMee6ImportCsv(result.rows),
      `user_id,xp\n${USER_ONE},100\n${USER_TWO},50\n${USER_THREE},25\n`,
    );
  });

  it("retries rate limits using Retry-After", async () => {
    let attempt = 0;
    const delays: number[] = [];
    const fetchImpl: Mee6FetchFunction = async () => {
      attempt += 1;
      return attempt === 1
        ? jsonResponse({ error: "slow down" }, 429, { "retry-after": "0.01" })
        : jsonResponse(leaderboardPage([{ id: USER_ONE, xp: 100 }]));
    };

    const result = await fetchMee6Leaderboard({
      guildId: GUILD_ID,
      fetchImpl,
      retryDelay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    assert.equal(attempt, 2);
    assert.deepEqual(delays, [10]);
    assert.equal(result.rows.length, 1);
  });

  it("rejects duplicate users across pages", async () => {
    const fetchImpl: Mee6FetchFunction = async () =>
      jsonResponse(leaderboardPage([{ id: USER_ONE, xp: 100 }]));

    await assert.rejects(
      fetchMee6Leaderboard({
        guildId: GUILD_ID,
        pageSize: 1,
        pageDelayMilliseconds: 0,
        fetchImpl,
      }),
      /duplicate user/,
    );
  });

  it("rejects malformed user IDs, XP, and guild mismatches", async () => {
    await assert.rejects(
      fetchMee6Leaderboard({
        guildId: GUILD_ID,
        fetchImpl: async () =>
          jsonResponse(leaderboardPage([{ id: "not-an-id", xp: 10 }])),
      }),
      /invalid Discord user ID/,
    );
    await assert.rejects(
      fetchMee6Leaderboard({
        guildId: GUILD_ID,
        fetchImpl: async () =>
          jsonResponse(leaderboardPage([{ id: USER_ONE, xp: -1 }])),
      }),
      /invalid XP/,
    );
    await assert.rejects(
      fetchMee6Leaderboard({
        guildId: GUILD_ID,
        fetchImpl: async () =>
          jsonResponse({
            guild: { id: USER_ONE, name: "Wrong server" },
            players: [],
          }),
      }),
      /while .* was requested/,
    );
  });
});
