export type AdminXpOperation = "add" | "remove" | "set";

export interface AdminXpAdjustmentInput {
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  channelId: string | null;
  discordInteractionId: string;
  operation: AdminXpOperation;
  amount: number;
  reason: string | null;
  createdAt: Date;
}

export type AdminXpCalculation =
  | {
      status: "applied" | "unchanged";
      previousXp: number;
      newXp: number;
      delta: number;
    }
  | {
      status: "insufficient";
      previousXp: number;
      requestedAmount: number;
    };

export type AdminXpAdjustmentResult =
  | AdminXpCalculation
  | {
      status: "duplicate";
      previousXp: number;
      newXp: number;
      delta: number;
    };

function requireSafeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function calculateAdminXpAdjustment(
  currentXp: number,
  operation: AdminXpOperation,
  amount: number,
): AdminXpCalculation {
  requireSafeNonNegativeInteger(currentXp, "Current Yapper XP");
  requireSafeNonNegativeInteger(amount, "Requested XP");

  if ((operation === "add" || operation === "remove") && amount === 0) {
    throw new RangeError(`${operation} requires an amount greater than zero.`);
  }

  if (operation === "remove" && amount > currentXp) {
    return {
      status: "insufficient",
      previousXp: currentXp,
      requestedAmount: amount,
    };
  }

  const newXp =
    operation === "add"
      ? currentXp + amount
      : operation === "remove"
        ? currentXp - amount
        : amount;

  requireSafeNonNegativeInteger(newXp, "Resulting Yapper XP");

  return {
    status: newXp === currentXp ? "unchanged" : "applied",
    previousXp: currentXp,
    newXp,
    delta: newXp - currentXp,
  };
}

export interface AdminXpService {
  adjust(input: AdminXpAdjustmentInput): Promise<AdminXpAdjustmentResult>;
}
