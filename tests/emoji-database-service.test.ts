import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";

import { PostgresEmojiService } from "../src/database/emoji-service.js";

describe("PostgresEmojiService leaderboard ordering", () => {
  it("orders numeric emoji totals before converting them to text", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);

        switch (queries.length) {
          case 1:
            return { rows: [] };
          case 2:
            return {
              rows: [
                {
                  timezone: "Europe/Berlin",
                  emoji_tracking_started_at: new Date(
                    "2026-08-11T00:00:00.000Z",
                  ),
                },
              ],
            };
          case 3:
            return { rows: [{ count: "3" }] };
          case 4:
            return {
              rows: [
                { leaderboard_key: "user-33", total: "33" },
                { leaderboard_key: "user-21", total: "21" },
                { leaderboard_key: "user-3", total: "3" },
              ],
            };
          default:
            throw new Error("Unexpected database query.");
        }
      },
    } as unknown as Pool;
    const service = new PostgresEmojiService(pool);

    const page = await service.getLeaderboardPage({
      guildId: "939811280657719327",
      metric: "users",
      scope: "all",
      page: 1,
      now: new Date("2026-08-12T08:00:00.000Z"),
    });
    const leaderboardQuery = queries[3] ?? "";

    assert.deepEqual(
      page.entries.map((entry) => entry.count),
      [33, 21, 3],
    );
    assert.match(leaderboardQuery, /ORDER BY totals\.total DESC/);
    assert.doesNotMatch(leaderboardQuery, /ORDER BY total DESC/);
  });
});
