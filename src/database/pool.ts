import { Pool } from "pg";

import type { DatabaseConfig } from "../config/environment.js";

export function createDatabasePool(config: DatabaseConfig): Pool {
  const pool = new Pool({
    ...config,
    max: 10,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
  });

  return pool;
}
