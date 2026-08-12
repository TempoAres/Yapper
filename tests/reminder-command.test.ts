import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildReminderCreatedResponse,
  buildReminderListResponse,
  reminderCommand,
} from "../src/commands/reminder.js";
import type { Reminder } from "../src/services/reminders/reminder-service.js";

const reminder: Reminder = {
  id: 42,
  guildId: "939811280657719327",
  userId: "939644859092992060",
  channelId: "153452985728578777",
  message: "Check the oven",
  remindAt: new Date("2026-08-12T12:30:00.000Z"),
  deliveryAttempts: 0,
};

describe("reminder command", () => {
  it("confirms a reminder with exact and relative Discord timestamps", () => {
    const response = buildReminderCreatedResponse(reminder, "Europe/Berlin");

    assert.match(String(response.content), /Reminder \*\*#42\*\* set/);
    assert.match(String(response.content), /<t:1786537800:F>/);
    assert.match(String(response.content), /<t:1786537800:R>/);
    assert.match(String(response.content), /Check the oven/);
  });

  it("lists pending reminders and handles an empty list", () => {
    const response = buildReminderListResponse([reminder]);
    const empty = buildReminderListResponse([]);

    assert.match(String(response.content), /Your pending reminders/);
    assert.match(String(response.content), /#42/);
    assert.match(String(empty.content), /no pending reminders/i);
  });

  it("registers set, list, and cancel subcommands", () => {
    const json = reminderCommand.data.toJSON();

    assert.equal(json.name, "reminder");
    assert.deepEqual(
      json.options?.map((option) => option.name),
      ["set", "list", "cancel"],
    );
    const set = json.options?.[0];
    assert.ok(set && "options" in set);
    assert.deepEqual(set.options?.map((option) => option.name), [
      "date",
      "time",
      "message",
    ]);
  });
});
