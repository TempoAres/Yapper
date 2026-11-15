import { escapeMarkdown, type Client } from "discord.js";

const CUSTOM_EMOJI = /<a?:\w{2,32}:\d{17,20}>/gu;
const EMOJI_PARTS = /^<(a?):\w{2,32}:(\d{17,20})>$/u;
const RETRY_DELAY = 60_000;
const MAX_DISPLAY_REASON_LENGTH = 1_500;

/** Escape user formatting without altering Discord's custom emoji markup. */
export function formatAfkReason(reason: string): string {
  let formatted = "";
  let offset = 0;
  for (const match of reason.matchAll(CUSTOM_EMOJI)) {
    formatted += escapeMarkdown(reason.slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  formatted += escapeMarkdown(reason.slice(offset));
  if (formatted.length <= MAX_DISPLAY_REASON_LENGTH) return formatted;

  // Shorthand expansion can exceed Discord's message limit. Do not cut through
  // an emoji, Markdown escape, or Unicode code point when shortening the reply.
  let shortened = "";
  for (const match of formatted.matchAll(/<a?:\w{2,32}:\d{17,20}>|\\.|./gsu)) {
    if (shortened.length + match[0].length >= MAX_DISPLAY_REASON_LENGTH) break;
    shortened += match[0];
  }
  return `${shortened}…`;
}

/** Application emojis can be sent in any guild, even without external-emoji permission. */
export class AfkEmojiResolver {
  private loaded: Promise<unknown> | undefined;
  private readonly pending = new Map<string, Promise<string>>();
  private readonly failedUntil = new Map<string, number>();

  public constructor(private readonly client: Client) {}

  public async resolve(reason: string, guildId: string): Promise<string> {
    // Also accept :name: for emojis the bot knows; prefer the current server.
    const expanded = reason.replace(
      /<a?:\w{2,32}:\d{17,20}>|:(\w{2,32}):/gu,
      (token: string, name: string | undefined) => {
        if (!name) return token;
        const emoji = this.client.guilds.cache.get(guildId)?.emojis.cache.find(
          (candidate) => candidate.name === name,
        ) ?? this.client.emojis.cache.find((candidate) => candidate.name === name);
        return emoji?.toString() ?? token;
      },
    );
    const replacements = new Map<string, string>();
    for (const match of expanded.matchAll(CUSTOM_EMOJI)) {
      if (!replacements.has(match[0])) {
        replacements.set(match[0], await this.resolveEmoji(match[0]));
      }
    }
    return expanded.replace(CUSTOM_EMOJI, (token) => replacements.get(token) ?? token);
  }

  private async resolveEmoji(token: string): Promise<string> {
    const parts = EMOJI_PARTS.exec(token);
    const manager = this.client.application?.emojis;
    if (!parts || !manager) return token;
    const id = parts[2]!;
    if ((this.failedUntil.get(id) ?? 0) > Date.now()) return token;
    this.failedUntil.delete(id);

    let pending = this.pending.get(id);
    if (!pending) {
      pending = (async () => {
        this.loaded ??= manager.fetch().catch((error: unknown) => {
          this.loaded = undefined;
          throw error;
        });
        await this.loaded;
        const name = `afk_${id}`;
        const existing = manager.cache.get(id) ?? manager.cache.find(
          (emoji) => emoji.name === name,
        );
        if (existing) return existing.toString();

        // Only numeric IDs from Discord markup reach this fixed CDN URL.
        const extension = parts[1] ? "gif" : "png";
        const emoji = await manager.create({
          name,
          attachment: `https://cdn.discordapp.com/emojis/${id}.${extension}?size=128`,
        });
        return emoji.toString();
      })();
      this.pending.set(id, pending);
    }

    try {
      return await pending;
    } catch (error) {
      this.failedUntil.set(id, Date.now() + RETRY_DELAY);
      console.warn(`Could not prepare AFK emoji ${id}:`, error);
      return token;
    } finally {
      this.pending.delete(id);
    }
  }
}
