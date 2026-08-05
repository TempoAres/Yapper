import {
  ChannelType,
  Client,
  Events,
  MessageType,
  type Message,
} from "discord.js";

import {
  MessageXpTracker,
  type MessageXpInput,
} from "../services/xp/message-xp-tracker.js";

function determineSource(message: Message<true>): MessageXpInput["source"] {
  if (message.channel.isThread()) {
    return message.channel.parent?.type === ChannelType.GuildForum
      ? "forum"
      : "thread";
  }

  if (message.attachments.size > 0 && message.content.trim().length === 0) {
    return "image";
  }

  return "message";
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

export function registerMessageXpListener(
  client: Client,
  messageXpTracker: MessageXpTracker,
): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!isSupportedUserMessage(message)) {
      return;
    }

    try {
      await messageXpTracker.process({
        guildId: message.guildId,
        userId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        content: message.content,
        attachmentCount: message.attachments.size,
        source: determineSource(message),
        createdAt: message.createdAt,
      });
    } catch (error) {
      console.error(
        `Could not process XP for guild ${message.guildId}, message ${message.id}:`,
        error,
      );
    }
  });
}
