import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";

const MIGRATION_LOCK_ID = 1_593_777_241;

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = path.resolve(process.cwd(), "migrations"),
): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    for (const filename of filenames) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [filename],
      );

      if ((existing.rowCount ?? 0) > 0) {
        continue;
      }

      const sql = await readFile(
        path.join(migrationsDirectory, filename),
        "utf8",
      );

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [filename],
        );
        await client.query("COMMIT");
        console.log(`Applied database migration ${filename}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
      }
    } finally {
      client.release();
    }
  }
}
