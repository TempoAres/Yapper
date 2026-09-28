import type { Pool } from "pg";

import {
  normalizeGlossaryAbbreviation,
  normalizeGlossaryDefinition,
  type GlossaryEntry,
  type GlossaryService,
  type SaveGlossaryEntryInput,
} from "../services/glossary/glossary-service.js";

interface GlossaryRow {
  guild_id: string;
  abbreviation: string;
  definition: string;
}

function mapEntry(row: GlossaryRow): GlossaryEntry {
  return {
    guildId: row.guild_id,
    abbreviation: row.abbreviation,
    definition: row.definition,
  };
}

export class PostgresGlossaryService implements GlossaryService {
  public constructor(private readonly pool: Pool) {}

  public async saveEntry(
    input: SaveGlossaryEntryInput,
  ): Promise<GlossaryEntry> {
    const abbreviation = normalizeGlossaryAbbreviation(input.abbreviation);
    const definition = normalizeGlossaryDefinition(input.definition);

    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id)
        VALUES ($1)
        ON CONFLICT (guild_id) DO NOTHING
      `,
      [input.guildId],
    );
    const result = await this.pool.query<GlossaryRow>(
      `
        INSERT INTO glossary_entries (
          guild_id,
          abbreviation,
          definition,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (guild_id, abbreviation)
        DO UPDATE SET
          definition = EXCLUDED.definition,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING guild_id, abbreviation, definition
      `,
      [input.guildId, abbreviation, definition, input.actorId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("The glossary entry was saved but could not be returned.");
    }

    return mapEntry(row);
  }

  public async getEntry(
    guildId: string,
    abbreviation: string,
  ): Promise<GlossaryEntry | undefined> {
    const normalized = normalizeGlossaryAbbreviation(abbreviation);
    const result = await this.pool.query<GlossaryRow>(
      `
        SELECT guild_id, abbreviation, definition
        FROM glossary_entries
        WHERE guild_id = $1 AND abbreviation = $2
      `,
      [guildId, normalized],
    );
    return result.rows[0] ? mapEntry(result.rows[0]) : undefined;
  }

  public async listAbbreviations(guildId: string): Promise<readonly string[]> {
    const result = await this.pool.query<Pick<GlossaryRow, "abbreviation">>(
      `
        SELECT abbreviation
        FROM glossary_entries
        WHERE guild_id = $1
        ORDER BY abbreviation
      `,
      [guildId],
    );
    return result.rows.map((row) => row.abbreviation);
  }
}
