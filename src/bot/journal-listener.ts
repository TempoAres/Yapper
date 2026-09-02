import { Client, Events, MessageType, type Message } from "discord.js";

import type { JournalService } from "../services/journal/journal-service.js";

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

export async function handleJournalMessage(
  message: Message,
  journalService: JournalService,
  targetUserId: string,
): Promise<boolean> {
  if (!isSupportedUserMessage(message) || message.author.id !== targetUserId) {
    return false;
  }

  return journalService.recordMessage({
    guildId: message.guildId,
    userId: message.author.id,
    messageId: message.id,
    channelId: message.channelId,
    channelName: channelName(message),
    content: journalMessageContent(message),
    createdAt: message.createdAt,
  });
}

export function registerJournalListener(
  client: Client,
  journalService: JournalService,
  targetUserId: string,
): void {
  client.on(Events.MessageCreate, (message) => {
    void handleJournalMessage(message, journalService, targetUserId).catch(
      (error: unknown) => {
        console.error(
          `Could not record journal message ${message.id} in guild ${message.guildId}:`,
          error,
        );
      },
    );
  });
}
