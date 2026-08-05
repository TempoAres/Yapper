export type ImportSource = "mee6" | "arcane";
export type ImportStatus = "previewed" | "applied" | "rolled_back";

export interface LegacyXpRow {
  userId: string;
  rawXp: number;
  adjustedXp: number;
}

export interface ExpectedLegacyXpUser {
  userId: string;
  rawXp: number;
}

export interface ImportExpectations {
  expectedRowCount?: number;
  expectedTotalRawXp?: number;
  expectedUsers?: readonly ExpectedLegacyXpUser[];
}

export interface ImportValidationIssue {
  line: number | null;
  message: string;
}

export interface LegacyXpValidation {
  valid: boolean;
  rows: LegacyXpRow[];
  multiplier: number;
  multiplierDatabaseValue: string;
  totalRawXp: number;
  totalAdjustedXp: number;
  issues: ImportValidationIssue[];
  issueCount: number;
}

export interface CreateImportPreviewInput {
  guildId: string;
  source: ImportSource;
  rows: readonly LegacyXpRow[];
  multiplierDatabaseValue: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface ImportSummary {
  id: string;
  guildId: string;
  source: ImportSource;
  status: ImportStatus;
  multiplier: number;
  rowCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  appliedAt: Date | null;
  rolledBackAt: Date | null;
}

export interface ImportApplyResult {
  status: "applied" | "already_applied";
  import: ImportSummary;
}

export interface ImportRollbackResult {
  status: "rolled_back" | "already_rolled_back";
  import: ImportSummary;
  removedEmptyMembers: number;
}

export interface ImportService {
  preview(input: CreateImportPreviewInput): Promise<ImportSummary>;
  get(importId: string): Promise<ImportSummary | null>;
  apply(importId: string): Promise<ImportApplyResult>;
  rollback(importId: string): Promise<ImportRollbackResult>;
}

const DISCORD_USER_ID = /^\d{17,20}$/;
const NON_NEGATIVE_INTEGER = /^\d+$/;
const MAX_ROWS = 100_000;
const MAX_REPORTED_ISSUES = 50;
const MULTIPLIER_SCALE = 1_000_000n;

interface ParsedMultiplier {
  value: number;
  databaseValue: string;
  scaledValue: bigint;
}

function addIssue(
  issues: ImportValidationIssue[],
  issueCounter: { value: number },
  line: number | null,
  message: string,
): void {
  issueCounter.value += 1;

  if (issues.length < MAX_REPORTED_ISSUES) {
    issues.push({ line, message });
  }
}

function parseMultiplier(input: string | number): ParsedMultiplier {
  const rawValue = String(input).trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rawValue);

  if (!match) {
    throw new RangeError(
      "The multiplier must be a positive number with at most 6 decimal places.",
    );
  }

  const wholePart = match[1];
  const fractionalPart = (match[2] ?? "").padEnd(6, "0");

  if (!wholePart) {
    throw new RangeError("The multiplier is missing its whole-number part.");
  }

  const scaledValue = BigInt(wholePart) * MULTIPLIER_SCALE + BigInt(fractionalPart);

  if (scaledValue <= 0n || scaledValue > 100n * MULTIPLIER_SCALE) {
    throw new RangeError("The multiplier must be greater than 0 and at most 100.");
  }

  const databaseValue = `${BigInt(wholePart)}.${fractionalPart}`;

  return {
    value: Number(scaledValue) / Number(MULTIPLIER_SCALE),
    databaseValue,
    scaledValue,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === "," && !insideQuotes) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }

  if (insideQuotes) {
    throw new Error("contains an unclosed quoted value");
  }

  cells.push(cell.trim());
  return cells;
}

function parseExpectedSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

/**
 * Validates Yapper's deliberately small migration format: `user_id,xp`.
 * Usernames and levels are not accepted because IDs are stable and raw XP is
 * the only historical value used to calculate Yapper's all-time baseline.
 */
export function validateLegacyXpCsv(
  csv: string,
  multiplierInput: string | number = "1",
  expectations: ImportExpectations = {},
): LegacyXpValidation {
  const multiplier = parseMultiplier(multiplierInput);
  const issues: ImportValidationIssue[] = [];
  const issueCounter = { value: 0 };
  const rows: LegacyXpRow[] = [];
  const seenUserIds = new Map<string, number>();
  const normalizedCsv = csv.replace(/^\uFEFF/, "");
  const lines = normalizedCsv.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex < 0) {
    addIssue(issues, issueCounter, null, "The CSV file is empty.");
    return {
      valid: false,
      rows,
      multiplier: multiplier.value,
      multiplierDatabaseValue: multiplier.databaseValue,
      totalRawXp: 0,
      totalAdjustedXp: 0,
      issues,
      issueCount: issueCounter.value,
    };
  }

  let header: string[];

  try {
    header = parseCsvLine(lines[firstContentIndex] ?? "").map((cell) =>
      cell.toLowerCase(),
    );
  } catch (error) {
    addIssue(
      issues,
      issueCounter,
      firstContentIndex + 1,
      `The header ${(error as Error).message}.`,
    );
    header = [];
  }

  if (header.length !== 2 || header[0] !== "user_id" || header[1] !== "xp") {
    addIssue(
      issues,
      issueCounter,
      firstContentIndex + 1,
      "The header must be exactly: user_id,xp",
    );
  }

  let dataRowCount = 0;
  let totalRawXpBigInt = 0n;
  let totalAdjustedXpBigInt = 0n;

  for (let index = firstContentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      continue;
    }

    dataRowCount += 1;

    if (dataRowCount > MAX_ROWS) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        `The import exceeds the ${MAX_ROWS.toLocaleString("en-US")} row safety limit.`,
      );
      break;
    }

    let cells: string[];

    try {
      cells = parseCsvLine(line);
    } catch (error) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        `This row ${(error as Error).message}.`,
      );
      continue;
    }

    if (cells.length !== 2) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        "Each data row must contain exactly a Discord user ID and raw XP.",
      );
      continue;
    }

    const userId = cells[0] ?? "";
    const rawXpText = cells[1] ?? "";
    let rowIsValid = true;

    if (!DISCORD_USER_ID.test(userId)) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        "user_id must be a 17-20 digit Discord user ID.",
      );
      rowIsValid = false;
    }

    const duplicateLine = seenUserIds.get(userId);

    if (duplicateLine !== undefined) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        `user_id ${userId} is duplicated (first seen on line ${duplicateLine}).`,
      );
      rowIsValid = false;
    } else if (DISCORD_USER_ID.test(userId)) {
      seenUserIds.set(userId, index + 1);
    }

    if (!NON_NEGATIVE_INTEGER.test(rawXpText)) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        "xp must be a non-negative whole number.",
      );
      rowIsValid = false;
    }

    if (!rowIsValid) {
      continue;
    }

    const rawXpBigInt = BigInt(rawXpText);
    const adjustedXpBigInt =
      (rawXpBigInt * multiplier.scaledValue + MULTIPLIER_SCALE / 2n) /
      MULTIPLIER_SCALE;

    if (
      rawXpBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
      adjustedXpBigInt > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      addIssue(
        issues,
        issueCounter,
        index + 1,
        "XP is outside JavaScript's safe whole-number range after scaling.",
      );
      continue;
    }

    rows.push({
      userId,
      rawXp: Number(rawXpBigInt),
      adjustedXp: Number(adjustedXpBigInt),
    });
    totalRawXpBigInt += rawXpBigInt;
    totalAdjustedXpBigInt += adjustedXpBigInt;
  }

  if (dataRowCount === 0) {
    addIssue(issues, issueCounter, null, "The CSV has no XP data rows.");
  }

  if (
    totalRawXpBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
    totalAdjustedXpBigInt > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    addIssue(
      issues,
      issueCounter,
      null,
      "The combined XP total is outside JavaScript's safe whole-number range.",
    );
  }

  const totalRawXp = Number(totalRawXpBigInt);
  const totalAdjustedXp = Number(totalAdjustedXpBigInt);

  if (expectations.expectedRowCount !== undefined) {
    parseExpectedSafeInteger(expectations.expectedRowCount, "Expected row count");

    if (rows.length !== expectations.expectedRowCount) {
      addIssue(
        issues,
        issueCounter,
        null,
        `Expected ${expectations.expectedRowCount} valid rows, but found ${rows.length}.`,
      );
    }
  }

  if (expectations.expectedTotalRawXp !== undefined) {
    parseExpectedSafeInteger(
      expectations.expectedTotalRawXp,
      "Expected raw XP total",
    );

    if (totalRawXp !== expectations.expectedTotalRawXp) {
      addIssue(
        issues,
        issueCounter,
        null,
        `Expected ${expectations.expectedTotalRawXp} total raw XP, but found ${totalRawXp}.`,
      );
    }
  }

  const rowsByUserId = new Map(rows.map((row) => [row.userId, row]));

  for (const expectedUser of expectations.expectedUsers ?? []) {
    parseExpectedSafeInteger(expectedUser.rawXp, "Expected user XP");
    const actualRow = rowsByUserId.get(expectedUser.userId);

    if (!actualRow) {
      addIssue(
        issues,
        issueCounter,
        null,
        `Expected user ${expectedUser.userId} was not found.`,
      );
    } else if (actualRow.rawXp !== expectedUser.rawXp) {
      addIssue(
        issues,
        issueCounter,
        null,
        `Expected user ${expectedUser.userId} to have ${expectedUser.rawXp} raw XP, but found ${actualRow.rawXp}.`,
      );
    }
  }

  return {
    valid: issueCounter.value === 0,
    rows,
    multiplier: multiplier.value,
    multiplierDatabaseValue: multiplier.databaseValue,
    totalRawXp,
    totalAdjustedXp,
    issues,
    issueCount: issueCounter.value,
  };
}
