import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import type { Pool } from "pg";

import {
  buildWinLeaderboardResponse,
  createWinLeaderboardImageRows,
  parseWinButton,
  winsCommand,
} from "../src/commands/wins.js";
import { PostgresLeaderboardService } from "../src/database/leaderboard-service.js";
import type { LeaderboardWinPage } from "../src/services/leaderboards/leaderboard-service.js";

const requesterId = "939644859092992060";

function examplePage(
  overrides: Partial<LeaderboardWinPage> = {},
): LeaderboardWinPage {
  return {
    scope: "weekly",
    page: 1,
    pageSize: 10,
    totalPages: 2,
    participantCount: 12,
    visibleEntryCount: 12,
    entries: [
      { rank: 1, userId: requesterId, wins: 4 },
      { rank: 2, userId: "153452985728578777", wins: 1 },
    ],
    timezone: "Europe/Berlin",
    generatedAt: new Date("2026-08-12T10:00:00.000Z"),
    ...overrides,
  };
}

describe("leaderboard wins", () => {
  it("renders completed wins in the shared image leaderboard style", async () => {
    const page = examplePage();
    const rows = createWinLeaderboardImageRows(page);
    const response = await buildWinLeaderboardResponse(page, requesterId);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Weekly Leaderboard Wins");
    assert.equal(
      json.description,
      "Completed weekly XP leaderboards • Europe/Berlin",
    );
    assert.equal(rows[0]?.detail, "4 wins");
    assert.equal(rows[1]?.detail, "1 win");
    assert.match(json.image?.url ?? "", /^attachment:\/\//);
    assert.equal(response.files?.length, 1);
  });

  it("creates and validates requester-bound pagination", async () => {
    const response = await buildWinLeaderboardResponse(
      examplePage(),
      requesterId,
    );
    const row = response.components?.[0];

    assert.ok(row && "toJSON" in row);
    const buttons = (row as ActionRowBuilder<ButtonBuilder>).components.map(
      (button) => button.toJSON(),
    );
    assert.ok(buttons[2] && "custom_id" in buttons[2]);
    assert.equal(
      buttons[2].custom_id,
      `yapper:wins:next:weekly:2:${requesterId}`,
    );
    assert.deepEqual(
      parseWinButton(`yapper:wins:last:yearly:10:${requesterId}`),
      {
        action: "last",
        scope: "yearly",
        page: 10,
        requesterId,
      },
    );
    assert.equal(
      parseWinButton(`yapper:wins:last:weekly:11:${requesterId}`),
      null,
    );
    assert.equal(parseWinButton("yapper:wins:next:all:2:user"), null);
  });

  it("publishes only weekly, monthly, and yearly subcommands", () => {
    const json = winsCommand.data.toJSON();

    assert.equal(json.name, "wins");
    assert.deepEqual(
      json.options?.map((option) => option.name),
      ["weekly", "monthly", "yearly"],
    );
    for (const option of json.options ?? []) {
      assert.ok("options" in option);
      assert.deepEqual(option.options?.map((child) => child.name), ["page"]);
    }
  });

  it("excludes the active period when deriving wins from daily XP", async () => {
    const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = {
      query: async (sql: string, parameters: readonly unknown[] = []) => {
        queries.push({ sql, parameters });

        switch (queries.length) {
          case 1:
            return { rows: [] };
          case 2:
            return {
              rows: [
                {
                  timezone: "Europe/Berlin",
                  launched_at: new Date("2026-08-05T00:00:00.000Z"),
                },
              ],
            };
          case 3:
            return { rows: [{ count: "2" }] };
          case 4:
            return {
              rows: [
                { user_id: requesterId, wins: "4" },
                { user_id: "153452985728578777", wins: "1" },
              ],
            };
          default:
            throw new Error("Unexpected database query.");
        }
      },
    } as unknown as Pool;
    const service = new PostgresLeaderboardService(pool, "Europe/Berlin");

    const page = await service.getWinPage({
      guildId: "939811280657719327",
      scope: "weekly",
      page: 1,
      now: new Date("2026-08-12T08:00:00.000Z"),
    });

    assert.deepEqual(
      page.entries.map((entry) => entry.wins),
      [4, 1],
    );
    assert.match(queries[2]?.sql ?? "", /period_start < \$2::date/);
    assert.match(queries[2]?.sql ?? "", /PARTITION BY period_start/);
    assert.match(queries[2]?.sql ?? "", /ORDER BY xp DESC, user_id ASC/);
    assert.equal(queries[2]?.parameters[1], "2026-08-10");
    assert.match(queries[3]?.sql ?? "", /ORDER BY wins DESC, user_id ASC/);
  });
});
