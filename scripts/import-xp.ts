import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadDatabaseConfig } from "../src/config/environment.js";
import { PostgresImportService } from "../src/database/import-service.js";
import { runMigrations } from "../src/database/migrate.js";
import { createDatabasePool } from "../src/database/pool.js";
import {
  type ExpectedLegacyXpUser,
  type ImportExpectations,
  type ImportSource,
  type ImportSummary,
  validateLegacyXpCsv,
} from "../src/services/imports/import-service.js";
import {
  buildMee6ImportCsv,
  fetchMee6Leaderboard,
} from "../src/services/imports/mee6-fetcher.js";

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  const value = process.argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value.`);
  }

  return value;
}

function readRepeatedArguments(name: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) {
      continue;
    }

    const value = process.argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${name} needs a value.`);
    }

    values.push(value);
  }

  return values;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readNonNegativeInteger(name: string): number | undefined {
  const rawValue = readArgument(name);

  if (rawValue === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a non-negative whole number.`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} is outside JavaScript's safe whole-number range.`);
  }

  return value;
}

function readExpectedUsers(): ExpectedLegacyXpUser[] {
  return readRepeatedArguments("--expected-user").map((value) => {
    const match = /^(\d{17,20}):(\d+)$/.exec(value);

    if (!match?.[1] || !match[2]) {
      throw new Error(
        "--expected-user must use DISCORD_USER_ID:RAW_XP, for example 123456789012345678:5000.",
      );
    }

    const rawXp = Number(match[2]);

    if (!Number.isSafeInteger(rawXp)) {
      throw new Error("Expected user XP is outside JavaScript's safe range.");
    }

    return { userId: match[1], rawXp };
  });
}

function readExpectations(): ImportExpectations {
  const expectedRowCount = readNonNegativeInteger("--expected-row-count");
  const expectedTotalRawXp = readNonNegativeInteger("--expected-total-raw-xp");
  const expectedUsers = readExpectedUsers();
  const expectations: ImportExpectations = {};

  if (expectedRowCount !== undefined) {
    expectations.expectedRowCount = expectedRowCount;
  }

  if (expectedTotalRawXp !== undefined) {
    expectations.expectedTotalRawXp = expectedTotalRawXp;
  }

  if (expectedUsers.length > 0) {
    expectations.expectedUsers = expectedUsers;
  }

  return expectations;
}

function readSource(): ImportSource {
  const source = readArgument("--source") ?? "mee6";

  if (source !== "mee6" && source !== "arcane") {
    throw new Error("--source must be mee6 or arcane.");
  }

  return source;
}

function readMee6GuildId(): string {
  const explicitGuildId = readArgument("--guild-id");
  const leaderboardUrl = readArgument("--leaderboard-url");
  let guildIdFromUrl: string | undefined;

  if (leaderboardUrl) {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(leaderboardUrl);
    } catch {
      throw new Error("--leaderboard-url must be a complete MEE6 URL.");
    }

    if (
      parsedUrl.protocol !== "https:" ||
      (parsedUrl.hostname !== "mee6.xyz" && parsedUrl.hostname !== "www.mee6.xyz")
    ) {
      throw new Error("--leaderboard-url must use https://mee6.xyz/.");
    }

    const match = /^\/(?:[a-z]{2}\/)?leaderboard\/(\d{17,20})\/?$/i.exec(
      parsedUrl.pathname,
    );

    if (!match?.[1]) {
      throw new Error(
        "--leaderboard-url must look like https://mee6.xyz/en/leaderboard/SERVER_ID.",
      );
    }

    guildIdFromUrl = match[1];
  }

  if (explicitGuildId && guildIdFromUrl && explicitGuildId !== guildIdFromUrl) {
    throw new Error("--guild-id does not match the supplied MEE6 leaderboard URL.");
  }

  const guildId = explicitGuildId ?? guildIdFromUrl;

  if (!guildId) {
    throw new Error("Supply --leaderboard-url or --guild-id for fetch-mee6.");
  }

  return guildId;
}

async function readImportFile(): Promise<{ filename: string; csv: string }> {
  const filename = readArgument("--file");

  if (!filename) {
    throw new Error("Missing --file. Supply the path to a user_id,xp CSV file.");
  }

  const fileStats = await stat(filename);

  if (!fileStats.isFile()) {
    throw new Error(`${filename} is not a file.`);
  }

  if (fileStats.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("The import file exceeds the 25 MiB safety limit.");
  }

  return { filename, csv: await readFile(filename, "utf8") };
}

function showValidation(
  validation: ReturnType<typeof validateLegacyXpCsv>,
): void {
  console.log(`Valid rows: ${validation.rows.length.toLocaleString("en-US")}`);
  console.log(`Raw XP total: ${validation.totalRawXp.toLocaleString("en-US")}`);
  console.log(
    `Adjusted XP total: ${validation.totalAdjustedXp.toLocaleString("en-US")}`,
  );
  console.log(`Multiplier: ${validation.multiplierDatabaseValue}`);

  if (!validation.valid) {
    console.error(`Validation failed with ${validation.issueCount} issue(s):`);

    for (const issue of validation.issues) {
      const location = issue.line === null ? "File" : `Line ${issue.line}`;
      console.error(`- ${location}: ${issue.message}`);
    }

    if (validation.issueCount > validation.issues.length) {
      console.error(
        `- ${validation.issueCount - validation.issues.length} additional issue(s) were omitted.`,
      );
    }
  }
}

function showTopRows(
  rows: ReturnType<typeof validateLegacyXpCsv>["rows"],
): void {
  const topRows = [...rows]
    .sort((left, right) => right.rawXp - left.rawXp || left.userId.localeCompare(right.userId))
    .slice(0, 10);

  console.log("Top raw-XP rows:");
  topRows.forEach((row, index) => {
    console.log(
      `${index + 1}. ${row.userId}: ${row.rawXp.toLocaleString("en-US")} raw / ${row.adjustedXp.toLocaleString("en-US")} adjusted`,
    );
  });
}

function showImport(importSummary: ImportSummary): void {
  console.log(`Import ID: ${importSummary.id}`);
  console.log(`Server ID: ${importSummary.guildId}`);
  console.log(`Source: ${importSummary.source}`);
  console.log(`Status: ${importSummary.status}`);
  console.log(`Rows: ${importSummary.rowCount.toLocaleString("en-US")}`);
  console.log(`Multiplier: ${importSummary.multiplier}`);
  console.log(`Created: ${importSummary.createdAt.toISOString()}`);
  console.log(`Applied: ${importSummary.appliedAt?.toISOString() ?? "not applied"}`);
  console.log(
    `Rolled back: ${importSummary.rolledBackAt?.toISOString() ?? "not rolled back"}`,
  );
  console.log(`Metadata: ${JSON.stringify(importSummary.metadata, null, 2)}`);
}

function requireConfirmation(action: "apply" | "rollback"): void {
  if (!hasFlag("--confirm")) {
    throw new Error(
      `${action} changes stored XP. Re-run the reviewed command with --confirm.`,
    );
  }
}

async function runWithDatabase(
  operation: (service: PostgresImportService) => Promise<void>,
): Promise<void> {
  const pool = createDatabasePool(loadDatabaseConfig());

  try {
    await runMigrations(pool);
    await operation(new PostgresImportService(pool));
  } finally {
    await pool.end();
  }
}

async function validateOrPreview(command: "validate" | "preview"): Promise<void> {
  const { filename, csv } = await readImportFile();
  const multiplier = readArgument("--multiplier") ?? "1";
  const expectations = readExpectations();
  const validation = validateLegacyXpCsv(csv, multiplier, expectations);

  showValidation(validation);

  if (!validation.valid) {
    throw new Error("Fix the reported CSV issues before creating a preview.");
  }

  showTopRows(validation.rows);

  if (command === "validate") {
    console.log("Validation passed. No database data was changed.");
    return;
  }

  const guildId = readArgument("--guild-id") ?? process.env.DISCORD_GUILD_ID?.trim();

  if (!guildId) {
    throw new Error("Missing --guild-id and DISCORD_GUILD_ID is not configured.");
  }

  const source = readSource();
  const metadata = {
    formatVersion: 1,
    filename: path.basename(filename),
    sha256: createHash("sha256").update(csv).digest("hex"),
    totalRawXp: validation.totalRawXp,
    totalAdjustedXp: validation.totalAdjustedXp,
    expectations,
    comparisonOnly: source === "arcane",
  };

  await runWithDatabase(async (service) => {
    const importSummary = await service.preview({
      guildId,
      source,
      rows: validation.rows,
      multiplierDatabaseValue: validation.multiplierDatabaseValue,
      metadata,
    });
    console.log("Preview stored. Member XP has not changed.");
    showImport(importSummary);

    if (source === "mee6") {
      console.log(
        `After reviewing the totals, apply with: pnpm xp:import -- apply --import-id ${importSummary.id} --confirm`,
      );
    } else {
      console.log("Arcane previews are comparison-only and cannot be applied.");
    }
  });
}

async function fetchAndSaveMee6(): Promise<void> {
  const guildId = readMee6GuildId();
  const outputFilename = readArgument("--output") ?? path.join("imports", "mee6.csv");
  console.log(`Fetching public MEE6 leaderboard for server ${guildId}...`);
  const result = await fetchMee6Leaderboard({
    guildId,
    onPageFetched: (page, rowCount) => {
      console.log(`Fetched page ${page + 1}: ${rowCount.toLocaleString("en-US")} rows.`);
    },
  });
  const csv = buildMee6ImportCsv(result.rows);
  const validation = validateLegacyXpCsv(csv);

  showValidation(validation);

  if (!validation.valid) {
    throw new Error("The downloaded MEE6 data failed Yapper's CSV validation.");
  }

  showTopRows(validation.rows);
  await mkdir(path.dirname(path.resolve(outputFilename)), { recursive: true });

  try {
    await writeFile(outputFilename, csv, {
      encoding: "utf8",
      flag: hasFlag("--overwrite") ? "w" : "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${path.resolve(outputFilename)} already exists. Keep it as a backup or re-run with --overwrite.`,
      );
    }

    throw error;
  }

  console.log(`Downloaded ${result.guildName} across ${result.pagesFetched} page(s).`);
  console.log(`Private CSV saved to: ${path.resolve(outputFilename)}`);
  console.log("Usernames, avatars, and other MEE6 profile data were not saved.");
  console.log(
    `Next preview command: pnpm xp:import -- preview --file "${outputFilename}" --guild-id ${guildId} --expected-row-count ${validation.rows.length} --expected-total-raw-xp ${validation.totalRawXp}`,
  );
}

async function main(): Promise<void> {
  const firstArgument = process.argv[2];
  const command = firstArgument === "--" ? process.argv[3] : firstArgument;

  if (command === "fetch-mee6") {
    await fetchAndSaveMee6();
    return;
  }

  if (command === "validate" || command === "preview") {
    await validateOrPreview(command);
    return;
  }

  const importId = readArgument("--import-id");

  if (!importId) {
    throw new Error(
      "Use validate|preview with --file, or show|apply|rollback with --import-id.",
    );
  }

  if (command === "show") {
    await runWithDatabase(async (service) => {
      const importSummary = await service.get(importId);

      if (!importSummary) {
        throw new Error(`Import ${importId} does not exist.`);
      }

      showImport(importSummary);
    });
    return;
  }

  if (command === "apply") {
    requireConfirmation("apply");
    await runWithDatabase(async (service) => {
      const result = await service.apply(importId);
      console.log(
        result.status === "applied"
          ? "MEE6 baseline applied successfully."
          : "This MEE6 baseline was already applied; no XP changed.",
      );
      showImport(result.import);
      console.log(
        `Emergency rollback command: pnpm xp:import -- rollback --import-id ${importId} --confirm`,
      );
    });
    return;
  }

  if (command === "rollback") {
    requireConfirmation("rollback");
    await runWithDatabase(async (service) => {
      const result = await service.rollback(importId);
      console.log(
        result.status === "rolled_back"
          ? `Baseline restored. Removed ${result.removedEmptyMembers} now-empty member row(s).`
          : "This import was already rolled back; no XP changed.",
      );
      showImport(result.import);
    });
    return;
  }

  throw new Error(
    "Unknown command. Use fetch-mee6, validate, preview, show, apply, or rollback.",
  );
}

main().catch((error: unknown) => {
  console.error("XP import command failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
