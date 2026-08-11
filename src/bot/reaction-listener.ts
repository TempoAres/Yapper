import {
  Client,
  Events,
} from "discord.js";

import type { ReactionTracker } from "../services/reactions/reaction-tracker.js";

export function createReactionEmojiKey(emoji: {
  id: string | null;
  name: string | null;
}): string {
  return emoji.id
    ? `custom:${emoji.id}`
    : `unicode:${emoji.name ?? "unknown"}`;
}

export function registerReactionListener(
  client: Client,
  tracker: ReactionTracker,
): void {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      const message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;

      if (!message.inGuild()) {
        return;
      }

      await tracker.add({
        guildId: message.guildId,
        messageId: message.id,
        emojiKey: createReactionEmojiKey(reaction.emoji),
        reactorUserId: user.id,
        messageAuthorId: message.author.id,
        reactorIsBot: user.bot,
        messageAuthorIsBot: message.author.bot,
        createdAt: new Date(),
      });
    } catch (error) {
      console.error(
        `Could not record reaction add for message ${reaction.message.id}:`,
        error,
      );
    }
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    const guildId = reaction.message.guildId;

    if (!guildId) {
      return;
    }

    try {
      await tracker.remove({
        guildId,
        messageId: reaction.message.id,
        emojiKey: createReactionEmojiKey(reaction.emoji),
        reactorUserId: user.id,
        reactorIsBot: user.bot,
      });
    } catch (error) {
      console.error(
        `Could not record reaction removal for message ${reaction.message.id}:`,
        error,
      );
    }
  });

  client.on(Events.MessageReactionRemoveAll, async (message) => {
    if (!message.guildId) {
      return;
    }

    try {
      await tracker.clear({
        guildId: message.guildId,
        messageId: message.id,
      });
    } catch (error) {
      console.error(
        `Could not clear reactions for message ${message.id}:`,
        error,
      );
    }
  });

  client.on(Events.MessageReactionRemoveEmoji, async (reaction) => {
    const guildId = reaction.message.guildId;

    if (!guildId) {
      return;
    }

    try {
      await tracker.clear({
        guildId,
        messageId: reaction.message.id,
        emojiKey: createReactionEmojiKey(reaction.emoji),
      });
    } catch (error) {
      console.error(
        `Could not clear an emoji's reactions for message ${reaction.message.id}:`,
        error,
      );
    }
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!message.guildId) {
      return;
    }

    try {
      await tracker.clear({
        guildId: message.guildId,
        messageId: message.id,
      });
    } catch (error) {
      console.error(
        `Could not clear reactions for deleted message ${message.id}:`,
        error,
      );
    }
  });

  client.on(Events.MessageBulkDelete, async (messages) => {
    for (const message of messages.values()) {
      if (!message.guildId) {
        continue;
      }

      try {
        await tracker.clear({
          guildId: message.guildId,
          messageId: message.id,
        });
      } catch (error) {
        console.error(
          `Could not clear reactions for bulk-deleted message ${message.id}:`,
          error,
        );
      }
    }
  });
}
