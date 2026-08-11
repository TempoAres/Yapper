import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";

import {
  buildEmojiLeaderboardResponse,
  createEmojiLeaderboardImageRows,
  emojiCommand,
  parseEmojiButton,
} from "../src/commands/emojis.js";
import type { EmojiLeaderboardPage } from "../src/services/emoji/emoji-service.js";
import type { LeaderboardMemberProfile } from "../src/services/leaderboards/leaderboard-image.js";

const requesterId = "939644859092992060";

function examplePage(
  overrides: Partial<EmojiLeaderboardPage> = {},
): EmojiLeaderboardPage {
  return {
    metric: "users",
    scope: "weekly",
    page: 1,
    pageSize: 10,
    totalPages: 2,
    participantCount: 16,
    visibleEntryCount: 16,
    entries: [
      { rank: 1, key: requesterId, count: 1_234 },
      { rank: 2, key: "153452985728578777", count: 950 },
    ],
    timezone: "Europe/Berlin",
    periodStart: "2026-08-10",
    periodEnd: "2026-08-11",
    generatedAt: new Date("2026-08-11T12:00:00.000Z"),
    ...overrides,
  };
}

describe("emoji leaderboard presentation", () => {
  it("renders Top Users as an image with view and page controls", async () => {
    const page = examplePage();
    const profiles = new Map<string, LeaderboardMemberProfile>([
      [
        requesterId,
        { userId: requesterId, displayName: "tempoares", avatarDataUri: null },
      ],
    ]);
    const rows = createEmojiLeaderboardImageRows(page);
    const response = await buildEmojiLeaderboardResponse(
      page,
      requesterId,
      profiles,
    );
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Weekly Emoji Users");
    assert.equal(json.description, "10 Aug 2026 – 11 Aug 2026 • Europe/Berlin");
    assert.match(json.image?.url ?? "", /^attachment:\/\//);
    assert.equal(response.files?.length, 1);
    assert.equal(response.components?.length, 2);
    assert.equal(rows[0]?.detail, "1,234");
    assert.equal(rows[0]?.namePrefix, "@");
  });

  it("renders Top Emojis without an @ prefix", async () => {
    const page = examplePage({
      metric: "emojis",
      entries: [{ rank: 1, key: "unicode:😀", count: 2_500 }],
    });
    const profiles = new Map<string, LeaderboardMemberProfile>([
      [
        "unicode:😀",
        {
          userId: "unicode:😀",
          displayName: "😀",
          avatarDataUri: null,
          iconText: "😀",
        },
      ],
    ]);
    const rows = createEmojiLeaderboardImageRows(page);
    const response = await buildEmojiLeaderboardResponse(
      page,
      requesterId,
      profiles,
    );
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    assert.equal(embed.toJSON().title, "Weekly Top Emojis");
    assert.equal(rows[0]?.namePrefix, "");
    assert.equal(rows[0]?.detail, "2,500");
  });

  it("creates requester-bound view and pagination buttons", async () => {
    const response = await buildEmojiLeaderboardResponse(
      examplePage(),
      requesterId,
    );
    const viewRow = response.components?.[0];
    const navigationRow = response.components?.[1];

    assert.ok(viewRow && "toJSON" in viewRow);
    assert.ok(navigationRow && "toJSON" in navigationRow);
    const viewButtons = (
      viewRow as ActionRowBuilder<ButtonBuilder>
    ).components.map((button) => button.toJSON());
    const navigationButtons = (
      navigationRow as ActionRowBuilder<ButtonBuilder>
    ).components.map((button) => button.toJSON());

    assert.equal(viewButtons[0]?.disabled, true);
    assert.ok(viewButtons[1] && "custom_id" in viewButtons[1]);
    assert.equal(
      viewButtons[1].custom_id,
      `yapper:emoji:emojis:emojis:weekly:1:${requesterId}`,
    );
    assert.ok(navigationButtons[2] && "custom_id" in navigationButtons[2]);
    assert.equal(
      navigationButtons[2].custom_id,
      `yapper:emoji:next:users:weekly:2:${requesterId}`,
    );
  });

  it("parses only valid emoji button IDs", () => {
    assert.deepEqual(
      parseEmojiButton(
        `yapper:emoji:last:emojis:yearly:10:${requesterId}`,
      ),
      {
        action: "last",
        metric: "emojis",
        scope: "yearly",
        page: 10,
        requesterId,
      },
    );
    assert.equal(
      parseEmojiButton(
        `yapper:emoji:last:emojis:yearly:11:${requesterId}`,
      ),
      null,
    );
    assert.equal(parseEmojiButton("yapper:emoji:invalid"), null);
  });

  it("publishes /emoji all|weekly|monthly|yearly with optional pages", () => {
    const json = emojiCommand.data.toJSON();

    assert.equal(json.name, "emoji");
    assert.deepEqual(
      json.options?.map((option) => option.name),
      ["all", "weekly", "monthly", "yearly"],
    );
    for (const option of json.options ?? []) {
      assert.ok("options" in option);
      assert.deepEqual(option.options?.map((child) => child.name), ["page"]);
    }
  });
});
