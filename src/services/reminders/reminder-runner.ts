import type { Client } from "discord.js";

import type { ReminderService } from "./reminder-service.js";

const POLL_INTERVAL_MS = 15_000;
const CLAIM_LIMIT = 25;

export class ReminderRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private readonly idleWaiters: Array<() => void> = [];

  public constructor(
    private readonly client: Client,
    private readonly service: ReminderService,
  ) {}

  public start(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    void this.tick();
  }

  public async stop(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.running) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    }
  }

  public async runOnce(now = new Date()): Promise<number> {
    const reminders = await this.service.claimDue({
      now,
      limit: CLAIM_LIMIT,
    });

    for (const reminder of reminders) {
      try {
        const channel = await this.client.channels.fetch(reminder.channelId);

        if (!channel?.isSendable()) {
          throw new Error("The reminder channel is missing or no longer sendable.");
        }

        await channel.send({
          content: `<@${reminder.userId}> reminder: ${reminder.message}`,
          allowedMentions: { users: [reminder.userId] },
          nonce: `yr-${reminder.id}`,
          enforceNonce: true,
        });
        await this.service.markDelivered(reminder.id, new Date());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.service.releaseForRetry({
          reminderId: reminder.id,
          error: message,
        });
        console.error(`Could not deliver reminder ${reminder.id}:`, error);
      }
    }

    return reminders.length;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runOnce();
    } catch (error) {
      console.error("Reminder delivery check failed:", error);
    } finally {
      this.running = false;
      for (const resolve of this.idleWaiters.splice(0)) {
        resolve();
      }

      if (!this.stopped) {
        this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
        this.timer.unref();
      }
    }
  }
}
