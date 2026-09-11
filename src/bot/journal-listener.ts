import { Client, Events, MessageType, type Message } from "discord.js";

import type {
  JournalContextMessage,
  JournalService,
} from "../services/journal/journal-service.js";

export const JOURNAL_CONTEXT_CHARACTER_LIMIT = 2_000;
export const JOURNAL_CONTEXT_MAX_AGE_MS = 30 * 60 * 1_000;

function isSupportedUserMessage(message: Message): message is Message<true> {
  return (
    message.inGuild() &&
    !message.author.bot &&
    message.webhookId === null &&
    !message.system &&
    (message.type === MessageType.Default || message.type === MessageType.Reply)
  );
}

function channelName(message: Message<true>): string {
  return "name" in message.channel && typeof message.channel.name === "string"
    ? message.channel.name
    : message.channelId;
}

export function journalMessageContent(message: Message<true>): string {
  const parts: string[] = [];
  const content = message.content.trim();

  if (content) {
    parts.push(content);
  }

  if (message.attachments.size > 0) {
    parts.push(
      ...Array.from(message.attachments.values(),
        (attachment) => `[Attachment: ${attachment.name ?? "unnamed file"}]`,
      ),
    );
  }

  if (message.stickers.size > 0) {
    parts.push(
      ...Array.from(
        message.stickers.values(),
        (sticker) => `[Sticker: ${sticker.name}]`,
      ),
    );
  }

  return parts.join("\n") || "[Message contained no text]";
}

function boundedContextContent(message: Message<true>): string {
  const content = journalMessageContent(message);

  if (content.length <= JOURNAL_CONTEXT_CHARACTER_LIMIT) {
    return content;
  }

  return `${content
    .slice(0, JOURNAL_CONTEXT_CHARACTER_LIMIT - 1)
    .trimEnd()}…`;
}

function contextFromMessage(
  message: Message,
  targetUserId: string,
): JournalContextMessage | undefined {
  if (!isSupportedUserMessage(message) || message.author.id === targetUserId) {
    return undefined;
  }

  return {
    messageId: message.id,
    content: boundedContextContent(message),
    createdAt: message.createdAt,
  };
}

/**
 * Keeps only the latest human message per channel in memory. Direct Discord
 * replies are preferred because they are stronger context than channel order.
 */
export class JournalContextTracker {
  private readonly recentByChannel = new Map<string, JournalContextMessage>();

  public constructor(
    private readonly maximumAgeMilliseconds = JOURNAL_CONTEXT_MAX_AGE_MS,
  ) {}

  public async observe(
    message: Message,
    targetUserId: string,
  ): Promise<JournalContextMessage | undefined> {
    if (!isSupportedUserMessage(message)) {
      return undefined;
    }

    if (message.author.id !== targetUserId) {
      const context = contextFromMessage(message, targetUserId);

      if (context) {
        const existing = this.recentByChannel.get(message.channelId);

        if (!existing || existing.createdAt <= context.createdAt) {
          this.recentByChannel.set(message.channelId, context);
        }
      }

      return undefined;
    }

    if (message.type === MessageType.Reply && message.reference?.messageId) {
      try {
        const referencedMessage = await message.fetchReference();
        const directContext = contextFromMessage(
          referencedMessage,
          targetUserId,
        );

        if (
          directContext &&
          referencedMessage.guildId === message.guildId &&
          referencedMessage.channelId === message.channelId
        ) {
          return directContext;
        }
      } catch {
        // Deleted or inaccessible reply targets fall back to recent context.
      }
    }

    const recent = this.recentByChannel.get(message.channelId);

    if (!recent) {
      return undefined;
    }

    const age = message.createdAt.getTime() - recent.createdAt.getTime();
    return age >= 0 && age <= this.maximumAgeMilliseconds ? recent : undefined;
  }
}

export async function handleJournalMessage(
  message: Message,
  journalService: JournalService,
  targetUserId: string,
  contextMessage?: JournalContextMessage,
): Promise<boolean> {
  if (!isSupportedUserMessage(message) || message.author.id !== targetUserId) {
    return false;
  }

  const record: Parameters<JournalService["recordMessage"]>[0] = {
    guildId: message.guildId,
    userId: message.author.id,
    messageId: message.id,
    channelId: message.channelId,
    channelName: channelName(message),
    content: journalMessageContent(message),
    createdAt: message.createdAt,
  };

  if (contextMessage) {
    record.contextMessage = contextMessage;
  }

  return journalService.recordMessage(record);
}

export function registerJournalListener(
  client: Client,
  journalService: JournalService,
  targetUserId: string,
): void {
  const contextTracker = new JournalContextTracker();

  client.on(Events.MessageCreate, (message) => {
    void contextTracker
      .observe(message, targetUserId)
      .then((contextMessage) =>
        handleJournalMessage(
          message,
          journalService,
          targetUserId,
          contextMessage,
        ),
      )
      .catch((error: unknown) => {
        console.error(
          `Could not record journal message ${message.id} in guild ${message.guildId}:`,
          error,
        );
      });
  });
}
