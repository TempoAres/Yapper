import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermissionFlagsBits } from "discord.js";

import {
  buildGlossaryListResponse,
  buildGlossaryLookupResponse,
  glossaryCommand,
  glossaryLookupCommand,
} from "../src/commands/glossary.js";
import {
  normalizeGlossaryAbbreviation,
  normalizeGlossaryDefinition,
} from "../src/services/glossary/glossary-service.js";

describe("glossary commands", () => {
  it("normalizes abbreviations for case-insensitive server lookups", () => {
    assert.equal(normalizeGlossaryAbbreviation("  ms  "), "MS");
    assert.equal(normalizeGlossaryAbbreviation("nether  hub"), "NETHER HUB");
    assert.equal(normalizeGlossaryDefinition("  Main Storage  "), "Main Storage");
    assert.throws(() => normalizeGlossaryAbbreviation("@everyone"), RangeError);
  });

  it("returns only the saved definition and suppresses mentions", () => {
    const response = buildGlossaryLookupResponse({
      guildId: "guild-1",
      abbreviation: "MS",
      definition: "Main Storage (Primary place to store items in your world)",
    });

    assert.equal(
      response.content,
      "Main Storage (Primary place to store items in your world)",
    );
    assert.deepEqual(response.allowedMentions, { parse: [] });
  });

  it("lists abbreviations without exposing their definitions", () => {
    const response = buildGlossaryListResponse(["MS", "NETHER HUB", "WD"]);
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Glossary abbreviations");
    assert.equal(json.description, "`MS`\n`NETHER HUB`\n`WD`");
    assert.doesNotMatch(json.description ?? "", /Main Storage/);
  });

  it("registers administrator configuration and public lookup commands", () => {
    const admin = glossaryCommand.data.toJSON();
    const lookup = glossaryLookupCommand.data.toJSON();

    assert.equal(admin.name, "glossary");
    assert.equal(
      admin.default_member_permissions,
      PermissionFlagsBits.Administrator.toString(),
    );
    assert.deepEqual(admin.options?.map((option) => option.name), ["add", "list"]);
    assert.equal(lookup.name, "g");
    assert.deepEqual(lookup.options?.map((option) => option.name), [
      "abbreviation",
    ]);
  });
});
