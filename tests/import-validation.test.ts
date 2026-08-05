import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateLegacyXpCsv } from "../src/services/imports/import-service.js";

const USER_ONE = "123456789012345678";
const USER_TWO = "234567890123456789";

describe("validateLegacyXpCsv", () => {
  it("preserves raw XP and applies a deterministic six-decimal multiplier", () => {
    const validation = validateLegacyXpCsv(
      `user_id,xp\n${USER_ONE},1001\n${USER_TWO},500`,
      "0.750000",
    );

    assert.equal(validation.valid, true);
    assert.equal(validation.multiplierDatabaseValue, "0.750000");
    assert.deepEqual(validation.rows, [
      { userId: USER_ONE, rawXp: 1001, adjustedXp: 751 },
      { userId: USER_TWO, rawXp: 500, adjustedXp: 375 },
    ]);
    assert.equal(validation.totalRawXp, 1501);
    assert.equal(validation.totalAdjustedXp, 1126);
  });

  it("accepts a UTF-8 BOM, blank lines, CRLF, and quoted values", () => {
    const validation = validateLegacyXpCsv(
      `\uFEFFuser_id,xp\r\n\r\n"${USER_ONE}","42"\r\n`,
    );

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.rows, [
      { userId: USER_ONE, rawXp: 42, adjustedXp: 42 },
    ]);
  });

  it("rejects duplicate users, invalid IDs, decimals, and extra columns", () => {
    const validation = validateLegacyXpCsv(
      [
        "user_id,xp",
        `${USER_ONE},100`,
        `${USER_ONE},200`,
        "not-a-discord-id,10",
        `${USER_TWO},2.5`,
        `${USER_TWO},20,unexpected`,
      ].join("\n"),
    );

    assert.equal(validation.valid, false);
    assert.equal(validation.issueCount, 4);
    assert.match(validation.issues[0]?.message ?? "", /duplicated/);
    assert.match(validation.issues[1]?.message ?? "", /Discord user ID/);
    assert.match(validation.issues[2]?.message ?? "", /whole number/);
    assert.match(validation.issues[3]?.message ?? "", /exactly a Discord user ID/);
  });

  it("rejects an unexpected schema or a file with no data rows", () => {
    const validation = validateLegacyXpCsv("id,level\n");

    assert.equal(validation.valid, false);
    assert.equal(validation.issueCount, 2);
    assert.match(validation.issues[0]?.message ?? "", /header must be exactly/i);
    assert.match(validation.issues[1]?.message ?? "", /no XP data rows/);
  });

  it("validates expected row count, total, and known users", () => {
    const csv = `user_id,xp\n${USER_ONE},100\n${USER_TWO},50`;
    const passing = validateLegacyXpCsv(csv, "1", {
      expectedRowCount: 2,
      expectedTotalRawXp: 150,
      expectedUsers: [{ userId: USER_ONE, rawXp: 100 }],
    });
    const failing = validateLegacyXpCsv(csv, "1", {
      expectedRowCount: 3,
      expectedTotalRawXp: 151,
      expectedUsers: [
        { userId: USER_ONE, rawXp: 99 },
        { userId: "345678901234567890", rawXp: 1 },
      ],
    });

    assert.equal(passing.valid, true);
    assert.equal(failing.valid, false);
    assert.equal(failing.issueCount, 4);
  });

  it("rejects dangerous multipliers and unsafe XP", () => {
    assert.throws(() => validateLegacyXpCsv("user_id,xp", "0"), /greater than 0/);
    assert.throws(
      () => validateLegacyXpCsv("user_id,xp", "1.1234567"),
      /at most 6 decimal places/,
    );

    const validation = validateLegacyXpCsv(
      `user_id,xp\n${USER_ONE},9007199254740992`,
    );
    assert.equal(validation.valid, false);
    assert.match(validation.issues[0]?.message ?? "", /safe whole-number range/);
  });
});
