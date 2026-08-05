export type ImportStatus = "previewed" | "applied" | "rolled_back";

export interface LegacyXpRow {
  guildId: string;
  userId: string;
  rawXp: number;
  adjustedXp: number;
}

/**
 * Phase 7 will implement preview, validation, apply, and rollback operations.
 * Arcane data must never be added on top of overlapping MEE6 all-time data.
 */
export interface ImportService {
  preview(rows: readonly LegacyXpRow[]): Promise<{ validRows: number }>;
  apply(importId: string): Promise<void>;
  rollback(importId: string): Promise<void>;
}
