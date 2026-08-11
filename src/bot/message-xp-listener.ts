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
import type { RoleRewardCoordinator } from "../services/roles/role-sync.js";
import { isGoogleSearchCommand } from "./google-search-listener.js";

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
  roleRewardCoordinator: RoleRewardCoordinator,
): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!isSupportedUserMessage(message)) {
      return;
    }

    if (isGoogleSearchCommand(message.content)) {
      return;
    }

    try {
      const result = await messageXpTracker.process({
        guildId: message.guildId,
        userId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        content: message.content,
        attachmentCount: message.attachments.size,
        source: determineSource(message),
        createdAt: message.createdAt,
      });

      if (result.awarded && message.member) {
        const roleResult = await roleRewardCoordinator.syncMember(message.member);

        if (roleResult.issues.length > 0) {
          console.warn(
            `Could not fully synchronize XP roles for guild ${message.guildId}, member ${message.author.id}:`,
            roleResult.issues.map((issue) => issue.message).join(" | "),
          );
        }
      }
    } catch (error) {
      console.error(
        `Could not process XP for guild ${message.guildId}, message ${message.id}:`,
        error,
      );
    }
  });
}
