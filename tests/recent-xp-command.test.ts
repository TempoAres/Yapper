import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRecentXpResponse } from "../src/commands/recent.js";
import type { RecentXpEntry } from "../src/services/xp/recent-xp-service.js";

const guildId = "1519320304260747335";

function buildResponse(entries: readonly RecentXpEntry[]) {
  return buildRecentXpResponse({
    guildId,
    displayName: "Tempo",
    avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
    entries,
    generatedAt: new Date("2026-08-05T15:00:00.000Z"),
  });
}

describe("recent XP presentation", () => {
  it("renders message metadata and a jump link without content", () => {
    const response = buildResponse([
      {
        amount: 25,
        source: "message",
        channelId: "1519320305091477536",
        messageId: "1534576595145199818",
        actorUserId: null,
        note: null,
        createdAt: new Date("2026-08-05T14:59:31.337Z"),
      },
    ]);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.fields?.[0]?.name, "+25 XP - message");
    assert.match(json.fields?.[0]?.value ?? "", /Jump to message/);
    assert.doesNotMatch(json.fields?.[0]?.value ?? "", /message content/i);
  });

  it("renders signed moderator adjustments, actor, and escaped reasons", () => {
    const response = buildResponse([
      {
        amount: -10,
        source: "admin",
        channelId: "1519320305091477536",
        messageId: null,
        actorUserId: "939644859092992060",
        note: "Corrected **duplicate** award",
        createdAt: new Date("2026-08-05T15:10:00.000Z"),
      },
    ]);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.fields?.[0]?.name, "-10 XP - admin");
    assert.match(json.fields?.[0]?.value ?? "", /Moderator: <@939644859092992060>/);
    assert.match(json.fields?.[0]?.value ?? "", /\\\*\\\*duplicate\\\*\\\*/);
  });

  it("explains when no recent events exist", () => {
    const response = buildResponse([]);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    assert.match(embed.toJSON().description ?? "", /No XP events/);
  });
});
