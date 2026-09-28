export const MAX_GLOSSARY_ABBREVIATION_LENGTH = 40;
export const MAX_GLOSSARY_DEFINITION_LENGTH = 1_500;

export interface GlossaryEntry {
  guildId: string;
  abbreviation: string;
  definition: string;
}

export interface SaveGlossaryEntryInput extends GlossaryEntry {
  actorId: string;
}

export interface GlossaryService {
  saveEntry(input: SaveGlossaryEntryInput): Promise<GlossaryEntry>;
  getEntry(guildId: string, abbreviation: string): Promise<GlossaryEntry | undefined>;
  listAbbreviations(guildId: string): Promise<readonly string[]>;
}

export function normalizeGlossaryAbbreviation(input: string): string {
  const abbreviation = input
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleUpperCase("en-US");

  if (
    abbreviation.length < 1 ||
    abbreviation.length > MAX_GLOSSARY_ABBREVIATION_LENGTH
  ) {
    throw new RangeError(
      `Glossary abbreviations must contain 1-${MAX_GLOSSARY_ABBREVIATION_LENGTH} characters.`,
    );
  }

  if (!/^[\p{L}\p{N}][\p{L}\p{N}._/+& -]*$/u.test(abbreviation)) {
    throw new RangeError(
      "Glossary abbreviations may contain letters, numbers, spaces, periods, underscores, slashes, plus signs, ampersands, and hyphens.",
    );
  }

  return abbreviation;
}

export function normalizeGlossaryDefinition(input: string): string {
  const definition = input.normalize("NFKC").trim();

  if (
    definition.length < 1 ||
    definition.length > MAX_GLOSSARY_DEFINITION_LENGTH
  ) {
    throw new RangeError(
      `Glossary definitions must contain 1-${MAX_GLOSSARY_DEFINITION_LENGTH.toLocaleString("en-US")} characters.`,
    );
  }

  return definition;
}
