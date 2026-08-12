import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Client } from "discord.js";

import { ReminderRunner } from "../src/services/reminders/reminder-runner.js";
import type {
  Reminder,
  ReminderService,
} from "../src/services/reminders/reminder-service.js";

const reminder: Reminder = {
  id: 42,
  guildId: "939811280657719327",
  userId: "939644859092992060",
  channelId: "153452985728578777",
  message: "Check the oven",
  remindAt: new Date("2026-08-12T12:30:00.000Z"),
  deliveryAttempts: 1,
};

class FakeReminderService implements ReminderService {
  public delivered: number[] = [];
  public retries: number[] = [];

  public async create(): Promise<Reminder> {
    return reminder;
  }

  public async list(): Promise<readonly Reminder[]> {
    return [];
  }

  public async cancel(): Promise<boolean> {
    return false;
  }

  public async claimDue(): Promise<readonly Reminder[]> {
    return [reminder];
  }

  public async markDelivered(reminderId: number): Promise<void> {
    this.delivered.push(reminderId);
  }

  public async releaseForRetry(input: { reminderId: number }): Promise<void> {
    this.retries.push(input.reminderId);
  }
}

describe("reminder runner", () => {
  it("pings only the reminder creator and marks delivery complete", async () => {
    const sent: unknown[] = [];
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (message: unknown) => {
            sent.push(message);
          },
        }),
      },
    } as unknown as Client;
    const service = new FakeReminderService();
    const runner = new ReminderRunner(client, service);

    assert.equal(await runner.runOnce(), 1);
    assert.deepEqual(service.delivered, [42]);
    assert.deepEqual(service.retries, []);
    assert.deepEqual(sent, [
      {
        content: "<@939644859092992060> reminder: Check the oven",
        allowedMentions: { users: ["939644859092992060"] },
        nonce: "yr-42",
        enforceNonce: true,
      },
    ]);
  });

  it("releases a reminder for retry when delivery fails", async () => {
    const client = {
      channels: {
        fetch: async () => null,
      },
    } as unknown as Client;
    const service = new FakeReminderService();
    const runner = new ReminderRunner(client, service);

    assert.equal(await runner.runOnce(), 1);
    assert.deepEqual(service.delivered, []);
    assert.deepEqual(service.retries, [42]);
  });
});
