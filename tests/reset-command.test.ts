import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildResetInfoResponse,
  resetCommand,
} from "../src/commands/reset.js";

describe("reset info command", () => {
  it("renders Discord timestamps that count down automatically", () => {
    const response = buildResetInfoResponse({
      timezone: "Europe/Berlin",
      daily: new Date("2026-08-12T22:00:00.000Z"),
      weekly: new Date("2026-08-16T22:00:00.000Z"),
      monthly: new Date("2026-08-31T22:00:00.000Z"),
      yearly: new Date("2026-12-31T23:00:00.000Z"),
    });
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Leaderboard resets");
    assert.match(json.description ?? "", /Europe\/Berlin/);
    assert.equal(
      json.fields?.[0]?.value,
      "<t:1786572000:F>\n**<t:1786572000:R>**",
    );
    assert.equal(
      json.fields?.[1]?.value,
      "<t:1786917600:F>\n**<t:1786917600:R>**",
    );
    assert.equal(
      json.fields?.[2]?.value,
      "<t:1788213600:F>\n**<t:1788213600:R>**",
    );
    assert.equal(
      json.fields?.[3]?.value,
      "<t:1798758000:F>\n**<t:1798758000:R>**",
    );
  });

  it("registers only /reset info", () => {
    const json = resetCommand.data.toJSON();

    assert.equal(json.name, "reset");
    assert.deepEqual(json.options?.map((option) => option.name), ["info"]);
  });
});
