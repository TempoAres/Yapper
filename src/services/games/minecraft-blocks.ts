import { minecraftBlockNames, minecraftVersion } from "./minecraft-blocks-data.js";

export { minecraftVersion };
export const minecraftBlockCount = Object.keys(minecraftBlockNames).length;
export const minecraftBlockAnswers = Object.values(minecraftBlockNames) as [string, ...string[]];

function normalizeBlockName(value: string): string {
  return value.trim().toLowerCase().replace(/^minecraft:/, "").replace(/[_\s]+/g, " ");
}

const blockIds = new Map<string, string>();
for (const [id, displayName] of Object.entries(minecraftBlockNames)) {
  blockIds.set(normalizeBlockName(id), id);
  blockIds.set(normalizeBlockName(displayName), id);
}

export function minecraftBlockKey(answer: string): string | undefined {
  return blockIds.get(normalizeBlockName(answer));
}
