import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTimestampResponse,
  resolveDiscordTimestampInput,
  timestampCommand,
} from "../src/commands/timestamp.js";

describe("timestamp command", () => {
  it("interprets ISO and European dates in Europe/Berlin", () => {
    assert.equal(
      resolveDiscordTimestampInput({
        date: "2026-08-12",
        time: "14:30",
        timezone: "Europe/Berlin",
      }).toISOString(),
      "2026-08-12T12:30:00.000Z",
    );
    assert.equal(
      resolveDiscordTimestampInput({
        date: "12.08.2026",
        time: "14:30:45",
        timezone: "Europe/Berlin",
      }).toISOString(),
      "2026-08-12T12:30:45.000Z",
    );
  });

  it("rejects invalid dates, times, and daylight-saving ambiguities", () => {
    assert.throws(
      () =>
        resolveDiscordTimestampInput({
          date: "31.02.2026",
          time: "14:30",
          timezone: "Europe/Berlin",
        }),
      /valid date/,
    );
    assert.throws(
      () =>
        resolveDiscordTimestampInput({
          date: "2026-08-12",
          time: "25:00",
          timezone: "Europe/Berlin",
        }),
      /valid 24-hour time/,
    );
    assert.throws(
      () =>
        resolveDiscordTimestampInput({
          date: "2026-03-29",
          time: "02:30",
          timezone: "Europe/Berlin",
        }),
      /does not exist/,
    );
    assert.throws(
      () =>
        resolveDiscordTimestampInput({
          date: "2026-10-25",
          time: "02:30",
          timezone: "Europe/Berlin",
        }),
      /occurs twice/,
    );
  });

  it("shows rendered and copyable exact and relative timestamps", () => {
    const response = buildTimestampResponse(
      new Date("2026-08-12T12:30:00.000Z"),
      "Europe/Berlin",
    );

    assert.match(String(response.content), /<t:1786537800:F>/);
    assert.match(String(response.content), /<t:1786537800:R>/);
    assert.match(String(response.content), /Interpreted in Europe\/Berlin/);
  });

  it("registers required date and time options", () => {
    const json = timestampCommand.data.toJSON();

    assert.equal(json.name, "timestamp");
    assert.deepEqual(json.options?.map((option) => option.name), ["date", "time"]);
    assert.ok(json.options?.every((option) => "required" in option && option.required));
  });
});
