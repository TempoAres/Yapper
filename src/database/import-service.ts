import type { Pool, PoolClient } from "pg";

import type {
  CreateImportPreviewInput,
  ImportApplyResult,
  ImportRollbackResult,
  ImportService,
  ImportSource,
  ImportStatus,
  ImportSummary,
} from "../services/imports/import-service.js";

interface ImportRow {
  id: string;
  guild_id: string;
  source: ImportSource;
  status: ImportStatus;
  multiplier: string;
  row_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  applied_at: Date | null;
  rolled_back_at: Date | null;
}

interface CountRow {
  count: string;
}

const DISCORD_ID = /^\d{17,20}$/;
const POSITIVE_DATABASE_ID = /^[1-9]\d*$/;
const MAX_IMPORT_ROWS = 100_000;
const INSERT_BATCH_SIZE = 1_000;

function parseSafeInteger(value: string | number, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Database ${label} is outside JavaScript's safe range.`);
  }

  return parsed;
}

function assertImportId(importId: string): void {
  if (!POSITIVE_DATABASE_ID.test(importId)) {
    throw new RangeError("Import ID must be a positive whole number.");
  }
}

function mapImport(row: ImportRow): ImportSummary {
  return {
    id: row.id,
    guildId: row.guild_id,
    source: row.source,
    status: row.status,
    multiplier: Number(row.multiplier),
    rowCount: parseSafeInteger(row.row_count, "import row count"),
    metadata: row.metadata,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
    rolledBackAt: row.rolled_back_at,
  };
}

async function getImportForUpdate(
  client: PoolClient,
  importId: string,
): Promise<ImportSummary | null> {
  const result = await client.query<ImportRow>(
    `
      SELECT
        id,
        guild_id,
        source,
        status,
        multiplier,
        row_count,
        metadata,
        created_at,
        applied_at,
        rolled_back_at
      FROM xp_imports
      WHERE id = $1
      FOR UPDATE
    `,
    [importId],
  );

  return result.rows[0] ? mapImport(result.rows[0]) : null;
}

async function getImportWithClient(
  client: PoolClient,
  importId: string,
): Promise<ImportSummary> {
  const result = await client.query<ImportRow>(
    `
      SELECT
        id,
        guild_id,
        source,
        status,
        multiplier,
        row_count,
        metadata,
        created_at,
        applied_at,
        rolled_back_at
      FROM xp_imports
      WHERE id = $1
    `,
    [importId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error(`Import ${importId} disappeared during its transaction.`);
  }

  return mapImport(row);
}

export class PostgresImportService implements ImportService {
  public constructor(private readonly pool: Pool) {}

  public async preview(
    input: CreateImportPreviewInput,
  ): Promise<ImportSummary> {
    if (!DISCORD_ID.test(input.guildId)) {
      throw new RangeError("guildId must be a 17-20 digit Discord server ID.");
    }

    if (input.rows.length === 0 || input.rows.length > MAX_IMPORT_ROWS) {
      throw new RangeError(
        `An import preview must contain 1-${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows.`,
      );
    }

    if (!/^\d+\.\d{6}$/.test(input.multiplierDatabaseValue)) {
      throw new RangeError("The import multiplier must have exactly 6 decimal places.");
    }

    const scaledMultiplier = BigInt(input.multiplierDatabaseValue.replace(".", ""));

    if (scaledMultiplier <= 0n || scaledMultiplier > 100_000_000n) {
      throw new RangeError("The import multiplier must be greater than 0 and at most 100.");
    }

    const seenUserIds = new Set<string>();

    for (const row of input.rows) {
      if (!DISCORD_ID.test(row.userId)) {
        throw new RangeError(`Invalid Discord user ID in preview: ${row.userId}`);
      }

      if (seenUserIds.has(row.userId)) {
        throw new RangeError(`Duplicate Discord user ID in preview: ${row.userId}`);
      }

      seenUserIds.add(row.userId);

      if (
        !Number.isSafeInteger(row.rawXp) ||
        row.rawXp < 0 ||
        !Number.isSafeInteger(row.adjustedXp) ||
        row.adjustedXp < 0
      ) {
        throw new RangeError(`Unsafe XP value in preview for user ${row.userId}.`);
      }

      const expectedAdjustedXp =
        (BigInt(row.rawXp) * scaledMultiplier + 500_000n) / 1_000_000n;

      if (BigInt(row.adjustedXp) !== expectedAdjustedXp) {
        throw new RangeError(
          `Adjusted XP does not match the multiplier for user ${row.userId}.`,
        );
      }
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO guild_settings (guild_id)
          VALUES ($1)
          ON CONFLICT (guild_id) DO NOTHING
        `,
        [input.guildId],
      );
      const importResult = await client.query<{ id: string }>(
        `
          INSERT INTO xp_imports (
            guild_id,
            source,
            status,
            multiplier,
            row_count,
            metadata
          )
          VALUES ($1, $2, 'previewed', $3, $4, $5::jsonb)
          RETURNING id
        `,
        [
          input.guildId,
          input.source,
          input.multiplierDatabaseValue,
          input.rows.length,
          JSON.stringify(input.metadata),
        ],
      );
      const importId = importResult.rows[0]?.id;

      if (!importId) {
        throw new Error("PostgreSQL did not return the new import preview ID.");
      }

      for (let offset = 0; offset < input.rows.length; offset += INSERT_BATCH_SIZE) {
        const batch = input.rows.slice(offset, offset + INSERT_BATCH_SIZE);
        const parameters: Array<string | number> = [];
        const valuePlaceholders = batch.map((row, index) => {
          const parameterIndex = index * 4;
          parameters.push(importId, row.userId, row.rawXp, row.adjustedXp);
          return `($${parameterIndex + 1}, $${parameterIndex + 2}, $${parameterIndex + 3}, $${parameterIndex + 4})`;
        });

        await client.query(
          `
            INSERT INTO xp_import_rows (import_id, user_id, raw_xp, adjusted_xp)
            VALUES ${valuePlaceholders.join(", ")}
          `,
          parameters,
        );
      }

      const createdImport = await getImportWithClient(client, importId);
      await client.query("COMMIT");
      return createdImport;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async get(importId: string): Promise<ImportSummary | null> {
    assertImportId(importId);
    const result = await this.pool.query<ImportRow>(
      `
        SELECT
          id,
          guild_id,
          source,
          status,
          multiplier,
          row_count,
          metadata,
          created_at,
          applied_at,
          rolled_back_at
        FROM xp_imports
        WHERE id = $1
      `,
      [importId],
    );

    return result.rows[0] ? mapImport(result.rows[0]) : null;
  }

  public async apply(importId: string): Promise<ImportApplyResult> {
    assertImportId(importId);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const importSummary = await getImportForUpdate(client, importId);

      if (!importSummary) {
        throw new Error(`Import ${importId} does not exist.`);
      }

      if (importSummary.status === "applied") {
        await client.query("COMMIT");
        return { status: "already_applied", import: importSummary };
      }

      if (importSummary.status === "rolled_back") {
        throw new Error(
          `Import ${importId} was rolled back and cannot be applied again. Create a new preview instead.`,
        );
      }

      if (importSummary.source !== "mee6") {
        throw new Error(
          "Arcane imports are comparison-only and cannot be applied on top of MEE6 data.",
        );
      }

      // Serializing on the guild row prevents two previews from racing to
      // become the active historical baseline.
      await client.query(
        "SELECT guild_id FROM guild_settings WHERE guild_id = $1 FOR UPDATE",
        [importSummary.guildId],
      );
      const activeImport = await client.query<{ id: string }>(
        `
          SELECT id
          FROM xp_imports
          WHERE guild_id = $1
            AND source = 'mee6'
            AND status = 'applied'
            AND id <> $2
        `,
        [importSummary.guildId, importId],
      );

      if (activeImport.rows[0]) {
        throw new Error(
          `MEE6 import ${activeImport.rows[0].id} is already active for this server. Roll it back before applying another preview.`,
        );
      }

      const stagedRows = await client.query<CountRow>(
        `
          SELECT COUNT(*)::text AS count
          FROM xp_import_rows
          WHERE import_id = $1
        `,
        [importId],
      );
      const stagedRowCount = parseSafeInteger(
        stagedRows.rows[0]?.count ?? "0",
        "staged import row count",
      );

      if (stagedRowCount !== importSummary.rowCount) {
        throw new Error(
          `Import ${importId} expected ${importSummary.rowCount} staged rows but found ${stagedRowCount}. Apply was refused.`,
        );
      }

      await client.query(
        `
          UPDATE xp_import_rows AS import_row
          SET
            member_existed_before_apply = TRUE,
            previous_legacy_xp_raw = member.legacy_xp_raw,
            previous_legacy_xp_adjusted = member.legacy_xp_adjusted
          FROM guild_members AS member
          WHERE import_row.import_id = $1
            AND member.guild_id = $2
            AND member.user_id = import_row.user_id
        `,
        [importId, importSummary.guildId],
      );
      await client.query(
        `
          UPDATE xp_import_rows
          SET
            member_existed_before_apply = FALSE,
            previous_legacy_xp_raw = 0,
            previous_legacy_xp_adjusted = 0
          WHERE import_id = $1
            AND member_existed_before_apply IS NULL
        `,
        [importId],
      );
      await client.query(
        `
          INSERT INTO guild_members (
            guild_id,
            user_id,
            legacy_xp_raw,
            legacy_xp_adjusted
          )
          SELECT $2, user_id, raw_xp, adjusted_xp
          FROM xp_import_rows
          WHERE import_id = $1
          ON CONFLICT (guild_id, user_id)
          DO UPDATE SET
            legacy_xp_raw = EXCLUDED.legacy_xp_raw,
            legacy_xp_adjusted = EXCLUDED.legacy_xp_adjusted,
            updated_at = NOW()
        `,
        [importId, importSummary.guildId],
      );
      await client.query(
        `
          UPDATE xp_imports
          SET status = 'applied', applied_at = NOW()
          WHERE id = $1
        `,
        [importId],
      );

      const appliedImport = await getImportWithClient(client, importId);
      await client.query("COMMIT");
      return { status: "applied", import: appliedImport };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async rollback(importId: string): Promise<ImportRollbackResult> {
    assertImportId(importId);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const importSummary = await getImportForUpdate(client, importId);

      if (!importSummary) {
        throw new Error(`Import ${importId} does not exist.`);
      }

      if (importSummary.status === "rolled_back") {
        await client.query("COMMIT");
        return {
          status: "already_rolled_back",
          import: importSummary,
          removedEmptyMembers: 0,
        };
      }

      if (importSummary.status !== "applied") {
        throw new Error(`Import ${importId} is only a preview and has not been applied.`);
      }

      await client.query(
        "SELECT guild_id FROM guild_settings WHERE guild_id = $1 FOR UPDATE",
        [importSummary.guildId],
      );
      const changedRows = await client.query<CountRow>(
        `
          SELECT COUNT(*)::text AS count
          FROM xp_import_rows AS import_row
          LEFT JOIN guild_members AS member
            ON member.guild_id = $2
            AND member.user_id = import_row.user_id
          WHERE import_row.import_id = $1
            AND (
              member.user_id IS NULL
              OR member.legacy_xp_raw <> import_row.raw_xp
              OR member.legacy_xp_adjusted <> import_row.adjusted_xp
            )
        `,
        [importId, importSummary.guildId],
      );
      const changedRowCount = parseSafeInteger(
        changedRows.rows[0]?.count ?? "0",
        "changed import row count",
      );

      if (changedRowCount > 0) {
        throw new Error(
          `Rollback refused because ${changedRowCount} imported legacy baseline row(s) changed after apply. No data was modified.`,
        );
      }

      await client.query(
        `
          UPDATE guild_members AS member
          SET
            legacy_xp_raw = import_row.previous_legacy_xp_raw,
            legacy_xp_adjusted = import_row.previous_legacy_xp_adjusted,
            updated_at = NOW()
          FROM xp_import_rows AS import_row
          WHERE import_row.import_id = $1
            AND member.guild_id = $2
            AND member.user_id = import_row.user_id
        `,
        [importId, importSummary.guildId],
      );
      const removedMembers = await client.query(
        `
          DELETE FROM guild_members AS member
          USING xp_import_rows AS import_row
          WHERE import_row.import_id = $1
            AND import_row.member_existed_before_apply = FALSE
            AND member.guild_id = $2
            AND member.user_id = import_row.user_id
            AND member.new_bot_xp = 0
        `,
        [importId, importSummary.guildId],
      );
      await client.query(
        `
          UPDATE xp_imports
          SET status = 'rolled_back', rolled_back_at = NOW()
          WHERE id = $1
        `,
        [importId],
      );

      const rolledBackImport = await getImportWithClient(client, importId);
      await client.query("COMMIT");
      return {
        status: "rolled_back",
        import: rolledBackImport,
        removedEmptyMembers: removedMembers.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
