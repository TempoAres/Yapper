export interface LevelProgress {
  level: number;
  totalXp: number;
  xpInCurrentLevel: number;
  xpForNextLevel: number;
  xpNeededForNextLevel: number;
  progress: number;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

/** XP needed to move from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  assertNonNegativeInteger(level, "level");
  return Math.round(500 + 70 * level + 0.22 * level * level);
}

/** Total XP needed to reach the start of `level`. */
export function totalXpForLevel(level: number): number {
  assertNonNegativeInteger(level, "level");

  let total = 0;
  for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
    total += xpToNextLevel(currentLevel);
  }

  return total;
}

/** Converts all-time XP into level and progress values used by rank commands. */
export function calculateLevelProgress(totalXp: number): LevelProgress {
  assertNonNegativeInteger(totalXp, "totalXp");

  let level = 0;
  let xpAtLevelStart = 0;
  let required = xpToNextLevel(level);

  while (totalXp - xpAtLevelStart >= required) {
    xpAtLevelStart += required;
    level += 1;
    required = xpToNextLevel(level);
  }

  const xpInCurrentLevel = totalXp - xpAtLevelStart;

  return {
    level,
    totalXp,
    xpInCurrentLevel,
    xpForNextLevel: required,
    xpNeededForNextLevel: required - xpInCurrentLevel,
    progress: xpInCurrentLevel / required,
  };
}
