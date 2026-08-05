import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateAdminXpAdjustment } from "../src/services/xp/admin-xp-service.js";

describe("calculateAdminXpAdjustment", () => {
  it("adds XP", () => {
    assert.deepEqual(calculateAdminXpAdjustment(100, "add", 25), {
      status: "applied",
      previousXp: 100,
      newXp: 125,
      delta: 25,
    });
  });

  it("removes XP without going below zero", () => {
    assert.deepEqual(calculateAdminXpAdjustment(100, "remove", 40), {
      status: "applied",
      previousXp: 100,
      newXp: 60,
      delta: -40,
    });
    assert.deepEqual(calculateAdminXpAdjustment(30, "remove", 40), {
      status: "insufficient",
      previousXp: 30,
      requestedAmount: 40,
    });
  });

  it("sets an exact balance and reports no-op sets", () => {
    assert.deepEqual(calculateAdminXpAdjustment(100, "set", 250), {
      status: "applied",
      previousXp: 100,
      newXp: 250,
      delta: 150,
    });
    assert.deepEqual(calculateAdminXpAdjustment(100, "set", 100), {
      status: "unchanged",
      previousXp: 100,
      newXp: 100,
      delta: 0,
    });
  });

  it("rejects zero-value add/remove requests", () => {
    assert.throws(
      () => calculateAdminXpAdjustment(100, "add", 0),
      /greater than zero/,
    );
    assert.throws(
      () => calculateAdminXpAdjustment(100, "remove", 0),
      /greater than zero/,
    );
  });

  it("rejects unsafe or negative values", () => {
    assert.throws(
      () => calculateAdminXpAdjustment(Number.MAX_SAFE_INTEGER, "add", 1),
      /safe integer/,
    );
    assert.throws(
      () => calculateAdminXpAdjustment(100, "set", -1),
      /non-negative safe integer/,
    );
  });
});
