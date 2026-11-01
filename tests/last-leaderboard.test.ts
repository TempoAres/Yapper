import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MessageFlags,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from "discord.js";
import type { Pool } from "pg";

import type { CommandContext } from "../src/commands/command.js";
import { commandsByName } from "../src/commands/index.js";
import {
  buildLeaderboardResponse,
  createLeaderboardImageRows,
  handleLeaderboardButton,
  lastLeaderboardCommand,
  parseLeaderboardButton,
} from "../src/commands/leaderboard.js";
import { PostgresLeaderboardService } from "../src/database/leaderboard-service.js";
import type {
  LeaderboardPage,
  LeaderboardService,
} from "../src/services/leaderboards/leaderboard-service.js";

const requesterId = "939644859092992060";
const guildId = "939811280657719327";

function examplePage(): LeaderboardPage {
  return {
    kind: "previous",
    scope: "monthly",
    page: 1,
    pageSize: 10,
    totalPages: 2,
    participantCount: 12,
    visibleEntryCount: 12,
    entries: [],
    timezone: "Europe/Berlin",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    launchLimited: false,
    generatedAt: new Date("2026-09-15T12:00:00.000Z"),
  };
}

describe("previous leaderboards", () => {
  it("registers /last with each completed period and optional pages", () => {
    assert.equal(commandsByName.get("last"), lastLeaderboardCommand);
    const json = lastLeaderboardCommand.data.toJSON();
    assert.deepEqual(json.options?.map((option) => option.name), [
      "daily", "weekly", "monthly", "yearly",
    ]);
    for (const option of json.options ?? []) {
      assert.ok("options" in option);
      assert.deepEqual(option.options?.map((child) => child.name), ["page"]);
    }
  });

  it("shows the completed period and earned XP without using today's levels", async () => {
    const page = examplePage();
    page.entries = [{
      rank: 1,
      userId: requesterId,
      xp: 5_073,
      allTimeXp: 1_593_932,
      recordStart: null,
      recordEnd: null,
    }];
    assert.equal(createLeaderboardImageRows(page, "previous")[0]?.detail, "XP: +5,073");
    const response = await buildLeaderboardResponse(page, requesterId, "previous");
    const embed = response.embeds?.[0];
    assert.ok(embed && "toJSON" in embed);
    assert.equal(embed.toJSON().title, "Last Monthly XP Leaderboard");
    assert.equal(embed.toJSON().description, "1–31 Aug 2026");
    assert.equal(response.files?.length, 1);
    const row = response.components?.[0] as ActionRowBuilder<ButtonBuilder>;
    const buttons = row.components.map((button) => button.toJSON());
    for (const button of buttons) {
      assert.ok("custom_id" in button);
      assert.equal(parseLeaderboardButton(button.custom_id)?.periodEnd, "2026-08-31");
      assert.equal(parseLeaderboardButton(button.custom_id)?.requesterId, requesterId);
      assert.ok(button.custom_id.length <= 100);
    }
    assert.equal(buttons[0]?.disabled, true);
    assert.equal(buttons[2]?.disabled, false);
  });

  it("rejects previous-board buttons without a period or with all-time scope", () => {
    for (const customId of [
      `yapper:lb:next:previous:monthly:2:${requesterId}`,
      `yapper:lb:next:previous:all:2:${requesterId}:2026-08-31`,
      `yapper:lb:next:level:monthly:2:${requesterId}:2026-08-31`,
      `yapper:lb:next:previous:monthly:11:${requesterId}:2026-08-31`,
    ]) {
      assert.equal(parseLeaderboardButton(customId), null);
    }
  });

  it("loads the requested previous period and page through the command", async () => {
    const calls: Parameters<LeaderboardService["getPreviousPage"]>[0][] = [];
    const replies: InteractionEditReplyOptions[] = [];
    let deferred = false;
    const context = {
      leaderboardService: {
        getPreviousPage: async (input: Parameters<LeaderboardService["getPreviousPage"]>[0]) => {
          assert.equal(deferred, true);
          calls.push(input);
          return examplePage();
        },
      },
    } as unknown as CommandContext;
    const interaction = {
      guildId,
      user: { id: requesterId },
      client: {},
      options: {
        getSubcommand: () => "monthly",
        getInteger: () => 2,
      },
      deferReply: async () => { deferred = true; },
      editReply: async (response: InteractionEditReplyOptions) => { replies.push(response); },
    } as unknown as ChatInputCommandInteraction;
    await lastLeaderboardCommand.execute(interaction, context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.guildId, guildId);
    assert.equal(calls[0]?.scope, "monthly");
    assert.equal(calls[0]?.page, 2);
    assert.equal(calls[0]?.periodEnd, undefined);
    assert.equal(replies.length, 1);
  });

  it("passes the original period to the service when navigating an older board", async () => {
    const calls: Parameters<LeaderboardService["getPreviousPage"]>[0][] = [];
    const context = {
      leaderboardService: {
        getPreviousPage: async (input: Parameters<LeaderboardService["getPreviousPage"]>[0]) => {
          calls.push(input);
          return { ...examplePage(), page: 2 };
        },
      },
    } as unknown as CommandContext;
    const interaction = {
      customId: `yapper:lb:next:previous:monthly:2:${requesterId}:2026-08-31`,
      guildId,
      user: { id: requesterId },
      client: {},
      deferUpdate: async () => {},
      editReply: async () => {},
    } as unknown as ButtonInteraction;
    assert.equal(await handleLeaderboardButton(interaction, context), true);
    assert.equal(calls[0]?.periodEnd, "2026-08-31");
    assert.equal(calls[0]?.page, 2);
    assert.equal(calls[0]?.scope, "monthly");
  });

  it("keeps controls bound to the requester and blocks direct-message use", async () => {
    const replies: InteractionReplyOptions[] = [];
    const context = {} as CommandContext;
    await handleLeaderboardButton({
      customId: `yapper:lb:next:previous:monthly:2:${requesterId}:2026-08-31`,
      user: { id: "100000000000000001" },
      reply: async (response: InteractionReplyOptions) => { replies.push(response); },
    } as unknown as ButtonInteraction, context);
    assert.match(String(replies[0]?.content), /\/last monthly/);
    assert.equal(replies[0]?.flags, MessageFlags.Ephemeral);
    await lastLeaderboardCommand.execute({
      guildId: null,
      reply: async (response: InteractionReplyOptions) => { replies.push(response); },
    } as unknown as ChatInputCommandInteraction, context);
    assert.match(String(replies[1]?.content), /inside a server/);
  });

  it("queries completed daily totals with guild boundaries and stable pagination", async () => {
    const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = {
      query: async (sql: string, parameters: readonly unknown[] = []) => {
        queries.push({ sql, parameters });
        if (sql.includes("SELECT timezone, launched_at")) {
          return { rows: [{ timezone: "Europe/Berlin", launched_at: new Date("2026-01-01T00:00:00Z") }] };
        }
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "12" }] };
        if (sql.includes("LIMIT")) {
          return { rows: [{ user_id: requesterId, xp: "5073", all_time_xp: "1593932", record_start: null, record_end: null }] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;
    const page = await new PostgresLeaderboardService(pool, "UTC").getPreviousPage({
      guildId,
      scope: "monthly",
      page: 10,
      now: new Date("2026-11-15T12:00:00Z"),
      periodEnd: "2026-08-31",
    });
    assert.equal(page.kind, "previous");
    assert.equal(page.timezone, "Europe/Berlin");
    assert.equal(page.periodStart, "2026-08-01");
    assert.equal(page.periodEnd, "2026-08-31");
    assert.equal(page.page, 2);
    assert.equal(page.entries[0]?.rank, 11);
    assert.equal(page.entries[0]?.xp, 5_073);
    assert.match(queries[2]?.sql ?? "", /FROM daily_xp_totals\s+WHERE guild_id = \$1/);
    assert.match(queries[2]?.sql ?? "", /xp_date BETWEEN \$2::date AND \$3::date/);
    assert.deepEqual(queries[2]?.parameters, [guildId, "2026-08-01", "2026-08-31"]);
    assert.deepEqual(queries[3]?.parameters, [guildId, "2026-08-01", "2026-08-31", 10, 10]);
    assert.match(queries[3]?.sql ?? "", /ORDER BY xp DESC, user_id ASC/);
  });
});
