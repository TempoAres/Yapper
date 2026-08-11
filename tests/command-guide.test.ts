import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCommandGuideResponse,
  commandGuideCommand,
} from "../src/commands/command-guide.js";

describe("command guide", () => {
  it("lists user-facing commands by category without descriptions", () => {
    const response = buildCommandGuideResponse();
    const embed = response.embeds?.[0];

    assert.ok(embed && "toJSON" in embed);
    const json = embed.toJSON();
    assert.equal(json.title, "Yapper command guide");
    assert.equal(json.description, undefined);
    assert.deepEqual(
      json.fields?.map((field) => field.name),
      [
        "Level leaderboard",
        "XP leaderboard",
        "Activity records",
        "Reaction leaderboards",
        "Emoji leaderboards",
        "Personal progress",
        "Level rewards",
        "Other",
      ],
    );
    assert.match(json.fields?.[0]?.value ?? "", /`\/lb all`/);
    assert.match(json.fields?.[1]?.value ?? "", /`\/xplb`/);
    const other = json.fields?.find((field) => field.name === "Other");
    assert.match(other?.value ?? "", /`\?g <query>`/);
    assert.doesNotMatch(
      json.fields?.map((field) => field.value).join("\n") ?? "",
      /administrator|moderator|sync-all/,
    );
  });

  it("registers the public /cmd command", () => {
    assert.equal(commandGuideCommand.data.toJSON().name, "cmd");
  });
});
