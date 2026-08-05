import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateLevelProgress,
  totalXpForLevel,
  xpToNextLevel,
} from "../src/services/xp/level-curve.js";

describe("xpToNextLevel", () => {
  it("matches the requested example values", () => {
    const examples = new Map([
      [1, 570],
      [10, 1_222],
      [25, 2_388],
      [50, 4_550],
      [75, 6_988],
      [93, 8_913],
      [100, 9_700],
      [160, 17_332],
      [200, 23_300],
    ]);

    for (const [level, expectedXp] of examples) {
      assert.equal(xpToNextLevel(level), expectedXp);
    }
  });

  it("rejects invalid levels", () => {
    assert.throws(() => xpToNextLevel(-1), RangeError);
    assert.throws(() => xpToNextLevel(1.5), RangeError);
  });
});

describe("calculateLevelProgress", () => {
  it("starts a new member at level zero", () => {
    assert.deepEqual(calculateLevelProgress(0), {
      level: 0,
      totalXp: 0,
      xpInCurrentLevel: 0,
      xpForNextLevel: 500,
      xpNeededForNextLevel: 500,
      progress: 0,
    });
  });

  it("handles an exact level boundary", () => {
    const levelTwoStart = totalXpForLevel(2);
    const result = calculateLevelProgress(levelTwoStart);

    assert.equal(result.level, 2);
    assert.equal(result.xpInCurrentLevel, 0);
    assert.equal(result.xpForNextLevel, xpToNextLevel(2));
  });

  it("reports progress within a level", () => {
    const level = 10;
    const earnedThisLevel = 611;
    const result = calculateLevelProgress(
      totalXpForLevel(level) + earnedThisLevel,
    );

    assert.equal(result.level, level);
    assert.equal(result.xpInCurrentLevel, earnedThisLevel);
    assert.equal(result.xpNeededForNextLevel, 611);
    assert.equal(result.progress, 0.5);
  });
});
