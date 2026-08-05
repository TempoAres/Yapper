import { createHash } from "node:crypto";

import type { MessageXpConfig } from "../../config/environment.js";
import type { XpSource, XpService } from "./xp-service.js";

type MessageXpSource = Extract<
  XpSource,
  "message" | "image" | "thread" | "forum"
>;

export interface MessageXpInput {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  content: string;
  attachmentCount: number;
  source: MessageXpSource;
  createdAt: Date;
}

export type MessageXpSkipReason =
  | "low_effort"
  | "cooldown"
  | "duplicate_content"
  | "duplicate_event";

export interface MessageXpResult {
  awarded: boolean;
  amount: number;
  reason?: MessageXpSkipReason;
}

interface MemberMessageState {
  lastAwardAt: number | null;
  recentFingerprints: Map<string, number>;
}

function normalizeContent(content: string): string {
  return content.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function isMeaningfulMessage(
  normalizedContent: string,
  attachmentCount: number,
): boolean {
  if (attachmentCount > 0) {
    return true;
  }

  if (normalizedContent.length < 3) {
    return false;
  }

  const lettersAndNumbers = normalizedContent.match(/[\p{L}\p{N}]/gu) ?? [];

  if (lettersAndNumbers.length < 2) {
    return false;
  }

  const compact = lettersAndNumbers.join("");
  const uniqueCharacters = new Set(compact);

  return compact.length < 5 || uniqueCharacters.size > 1;
}

function fingerprintContent(normalizedContent: string): string | null {
  if (!normalizedContent) {
    return null;
  }

  return createHash("sha256").update(normalizedContent).digest("hex");
}

/**
 * Applies short-lived, in-memory anti-spam rules before writing an XP event.
 * Only a one-way content hash is retained temporarily; message content is never
 * passed to PostgreSQL or written to disk.
 */
export class MessageXpTracker {
  private readonly memberStates = new Map<string, MemberMessageState>();

  public constructor(
    private readonly xpService: XpService,
    private readonly config: MessageXpConfig,
    private readonly random: () => number = Math.random,
  ) {
    if (config.maximumXp < config.minimumXp) {
      throw new RangeError("maximumXp must be at least minimumXp.");
    }
  }

  public async process(input: MessageXpInput): Promise<MessageXpResult> {
    const timestamp = input.createdAt.getTime();

    if (!Number.isFinite(timestamp)) {
      throw new RangeError("createdAt must be a valid date.");
    }

    if (!Number.isSafeInteger(input.attachmentCount) || input.attachmentCount < 0) {
      throw new RangeError("attachmentCount must be a non-negative whole number.");
    }

    const normalizedContent = normalizeContent(input.content);

    if (!isMeaningfulMessage(normalizedContent, input.attachmentCount)) {
      return { awarded: false, amount: 0, reason: "low_effort" };
    }

    const stateKey = `${input.guildId}:${input.userId}`;
    const state = this.getOrCreateMemberState(stateKey);
    this.removeExpiredFingerprints(state, timestamp);

    const fingerprint = fingerprintContent(normalizedContent);

    if (
      fingerprint &&
      state.recentFingerprints.has(fingerprint)
    ) {
      return { awarded: false, amount: 0, reason: "duplicate_content" };
    }

    if (fingerprint) {
      state.recentFingerprints.set(fingerprint, timestamp);
    }

    if (
      state.lastAwardAt !== null &&
      timestamp - state.lastAwardAt < this.config.cooldownMilliseconds
    ) {
      return { awarded: false, amount: 0, reason: "cooldown" };
    }

    const previousAwardAt = state.lastAwardAt;
    state.lastAwardAt = timestamp;
    const amount = this.randomXpAmount();

    try {
      const result = await this.xpService.award({
        guildId: input.guildId,
        userId: input.userId,
        channelId: input.channelId,
        messageId: input.messageId,
        discordEventId: `message:${input.messageId}`,
        amount,
        source: input.source,
        createdAt: input.createdAt,
      });

      if (!result.awarded) {
        state.lastAwardAt = previousAwardAt;
        return { awarded: false, amount: 0, reason: "duplicate_event" };
      }

      return { awarded: true, amount };
    } catch (error) {
      state.lastAwardAt = previousAwardAt;

      if (fingerprint) {
        state.recentFingerprints.delete(fingerprint);
      }

      throw error;
    }
  }

  private getOrCreateMemberState(key: string): MemberMessageState {
    const existing = this.memberStates.get(key);

    if (existing) {
      return existing;
    }

    const state: MemberMessageState = {
      lastAwardAt: null,
      recentFingerprints: new Map(),
    };
    this.memberStates.set(key, state);
    return state;
  }

  private removeExpiredFingerprints(
    state: MemberMessageState,
    timestamp: number,
  ): void {
    for (const [fingerprint, recordedAt] of state.recentFingerprints) {
      if (timestamp - recordedAt >= this.config.duplicateWindowMilliseconds) {
        state.recentFingerprints.delete(fingerprint);
      }
    }
  }

  private randomXpAmount(): number {
    const randomValue = Math.min(Math.max(this.random(), 0), 0.999_999_999);
    const range = this.config.maximumXp - this.config.minimumXp + 1;
    return this.config.minimumXp + Math.floor(randomValue * range);
  }
}
