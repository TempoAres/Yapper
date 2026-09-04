import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermissionFlagsBits } from "discord.js";

import {
  buildJournalStatusResponse,
  journalCommand,
} from "../src/commands/journal.js";
import type { JournalSession } from "../src/services/journal/journal-service.js";

const session: JournalSession = {
  id: 7,
  guildId: "939811280657719327",
  userId: "939644859092992060",
  status: "active",
  startedAt: new Date("2026-09-02T10:00:00.000Z"),
  endsAt: new Date("2026-09-03T10:00:00.000Z"),
  summaryText: undefined,
  messageCount: 321,
  deliveryAttempts: 0,
};

describe("journal command", () => {
  it("is server-only, administrator-only, and exposes lifecycle subcommands", () => {
    const json = journalCommand.data.toJSON();

    assert.equal(json.name, "journal");
    assert.equal(json.dm_permission, false);
    assert.equal(
      json.default_member_permissions,
      PermissionFlagsBits.Administrator.toString(),
    );
    assert.deepEqual(
      json.options?.map((option) => option.name),
      ["start", "status", "cancel", "summarize-now"],
    );
  });

  it("shows live Discord timestamps and the recorded message count", () => {
    const response = buildJournalStatusResponse(session);

    assert.match(response, /Personal journal \*\*#7\*\*/);
    assert.match(response, /Recorded messages: \*\*321\*\*/);
    assert.match(response, /<t:1788429600:R>/);
    assert.match(response, /continue automatically/);
    assert.match(response, /weekly report instead/);
  });
});
