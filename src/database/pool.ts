import { Pool } from "pg";

import type { DatabaseConfig } from "../config/environment.js";

export function createDatabasePool(config: DatabaseConfig): Pool {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: 10,
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
  });

  return pool;
}
