import { loadDatabaseConfig } from "../src/config/environment.js";
import { runMigrations } from "../src/database/migrate.js";
import { createDatabasePool } from "../src/database/pool.js";

async function migrate(): Promise<void> {
  const pool = createDatabasePool(loadDatabaseConfig());

  try {
    await runMigrations(pool);
    console.log("Database migrations are up to date.");
  } finally {
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
