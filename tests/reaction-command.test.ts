import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";

import {
  buildReactionLeaderboardResponse,
  parseReactionButton,
  reactionCommand,
} from "../src/commands/reactions.js";
import type { ReactionLeaderboardPage } from "../src/services/reactions/reaction-service.js";

const requesterId = "939644859092992060";

function examplePage(
  overrides: Partial<ReactionLeaderboardPage> = {},
): ReactionLeaderboardPage {
  return {
    metric: "received",
    page: 1,
    pageSize: 10,
    totalPages: 2,
    participantCount: 12,
    visibleEntryCount: 12,
    entries: [
      { rank: 1, userId: requesterId, count: 1_234 },
      { rank: 2, userId: "153452985728578777", count: 950 },
    ],
    generatedAt: new Date("2026-08-11T12:00:00.000Z"),
    ...overrides,
  };
}

describe("reaction leaderboard presentation", () => {
  it("renders reactions received as a paginated leaderboard", () => {
    const response = buildReactionLeaderboardResponse(
      examplePage(),
      requesterId,
    );
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Reactions received");
    assert.match(json.fields?.[0]?.value ?? "", /1,234/);
    assert.match(json.footer?.text ?? "", /Tracking starts with this update/);
  });

  it("creates requester-bound navigation buttons", () => {
    const response = buildReactionLeaderboardResponse(
      examplePage({ metric: "given" }),
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
      `yapper:react:next:given:2:${requesterId}`,
    );
  });

  it("parses only valid reaction navigation IDs", () => {
    assert.deepEqual(
      parseReactionButton(`yapper:react:last:received:10:${requesterId}`),
      {
        action: "last",
        metric: "received",
        page: 10,
        requesterId,
      },
    );
    assert.equal(
      parseReactionButton(`yapper:react:last:received:11:${requesterId}`),
      null,
    );
    assert.equal(parseReactionButton("yapper:lb:next:level:all:2:user"), null);
  });

  it("publishes the short /react received|given command hierarchy", () => {
    const json = reactionCommand.data.toJSON();

    assert.equal(json.name, "react");
    assert.deepEqual(
      json.options?.map((option) => option.name),
      ["received", "given"],
    );
  });
});
