import type {
  ReactionMembershipInput,
  ReactionService,
} from "./reaction-service.js";

export interface TrackReactionAddInput extends ReactionMembershipInput {
  messageAuthorId: string;
  reactorIsBot: boolean;
  messageAuthorIsBot: boolean;
  createdAt: Date;
}

export interface TrackReactionRemoveInput extends ReactionMembershipInput {
  reactorIsBot: boolean;
}

export class ReactionTracker {
  public constructor(private readonly service: ReactionService) {}

  public async add(input: TrackReactionAddInput): Promise<{ applied: boolean }> {
    if (
      input.reactorIsBot ||
      input.messageAuthorIsBot ||
      input.reactorUserId === input.messageAuthorId
    ) {
      return { applied: false };
    }

    return this.service.addReaction({
      guildId: input.guildId,
      messageId: input.messageId,
      emojiKey: input.emojiKey,
      reactorUserId: input.reactorUserId,
      messageAuthorId: input.messageAuthorId,
      createdAt: input.createdAt,
    });
  }

  public async remove(
    input: TrackReactionRemoveInput,
  ): Promise<{ applied: boolean }> {
    if (input.reactorIsBot) {
      return { applied: false };
    }

    return this.service.removeReaction({
      guildId: input.guildId,
      messageId: input.messageId,
      emojiKey: input.emojiKey,
      reactorUserId: input.reactorUserId,
    });
  }

  public async clear(input: {
    guildId: string;
    messageId: string;
    emojiKey?: string;
  }): Promise<{ removedCount: number }> {
    return this.service.clearReactions(input);
  }
}
