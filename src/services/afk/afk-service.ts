export const MAX_AFK_REASON_LENGTH = 300;
export const AFK_CLEAR_GRACE_MILLISECONDS = 30_000;

export interface AfkStatus {
  guildId: string;
  userId: string;
  reason: string;
  setAt: Date;
  clearAfter: Date;
  originalNickname: string | null;
  appliedNickname: string | null;
}

export interface SetAfkInput {
  guildId: string;
  userId: string;
  reason: string;
  setAt: Date;
  originalNickname: string | null;
  appliedNickname: string | null;
}

export interface AfkService {
  setAfk(input: SetAfkInput): Promise<AfkStatus>;
  getAfk(guildId: string, userId: string): Promise<AfkStatus | undefined>;
  getAfkForUsers(
    guildId: string,
    userIds: readonly string[],
  ): Promise<readonly AfkStatus[]>;
  clearAfkIfReady(
    guildId: string,
    userId: string,
    now: Date,
  ): Promise<AfkStatus | undefined>;
}

export function normalizeAfkReason(input: string): string {
  const reason = input.normalize("NFKC").trim().replace(/\s+/gu, " ") || "AFK";

  if (reason.length > MAX_AFK_REASON_LENGTH) {
    throw new RangeError(
      `AFK reasons can contain at most ${MAX_AFK_REASON_LENGTH} characters.`,
    );
  }

  return reason;
}
