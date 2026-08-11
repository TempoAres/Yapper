import { Client, Events, MessageType, type Message } from "discord.js";

import type {
  EmojiService,
  EmojiUsageCount,
} from "../services/emoji/emoji-service.js";

const customEmojiPattern = /<a?:[A-Za-z0-9_]{2,32}:(\d{17,20})>/g;
const unicodeEmojiPattern =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export function extractMessageEmojiUsages(
  content: string,
  serverEmojiIds: ReadonlySet<string>,
): readonly EmojiUsageCount[] {
  const counts = new Map<string, number>();

  for (const match of content.matchAll(customEmojiPattern)) {
    const emojiId = match[1];

    if (emojiId && serverEmojiIds.has(emojiId)) {
      increment(counts, `custom:${emojiId}`);
    }
  }

  for (const { segment } of graphemeSegmenter.segment(content)) {
    if (unicodeEmojiPattern.test(segment)) {
      increment(counts, `unicode:${segment}`);
    }
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([emojiKey, amount]) => ({ emojiKey, amount }));
}

function isSupportedUserMessage(message: Message): message is Message<true> {
  return (
    message.inGuild() &&
    !message.author.bot &&
    message.webhookId === null &&
    !message.system &&
    (message.type === MessageType.Default || message.type === MessageType.Reply)
  );
}

export async function handleMessageEmojiUsage(
  message: Message,
  emojiService: EmojiService,
): Promise<number> {
  if (!isSupportedUserMessage(message)) {
    return 0;
  }

  const usages = extractMessageEmojiUsages(
    message.content,
    new Set(message.guild.emojis.cache.keys()),
  );

  if (usages.length === 0) {
    return 0;
  }

  const result = await emojiService.recordMessage({
    guildId: message.guildId,
    userId: message.author.id,
    channelId: message.channelId,
    messageId: message.id,
    usages,
    createdAt: message.createdAt,
  });
  return result.recorded;
}

export function registerMessageEmojiListener(
  client: Client,
  emojiService: EmojiService,
): void {
  client.on(Events.MessageCreate, (message) => {
    void handleMessageEmojiUsage(message, emojiService).catch(
      (error: unknown) => {
        console.error(
          `Could not track emojis for guild ${message.guildId}, message ${message.id}:`,
          error,
        );
      },
    );
  });
}
