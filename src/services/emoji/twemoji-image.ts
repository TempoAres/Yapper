import { parse } from "@twemoji/parser";

const TWEMOJI_ASSET_BASE =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg";

export function getTwemojiAssetUrl(emoji: string): string | null {
  const entities = parse(emoji, {
    assetType: "svg",
    buildUrl: (codepoints) => `${TWEMOJI_ASSET_BASE}/${codepoints}.svg`,
  });
  const entity = entities[0];

  if (
    entities.length !== 1 ||
    !entity ||
    entity.text !== emoji ||
    entity.indices[0] !== 0 ||
    entity.indices[1] !== emoji.length
  ) {
    return null;
  }

  return entity.url;
}
