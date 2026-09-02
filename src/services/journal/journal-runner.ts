import { AttachmentBuilder, type Client, type User } from "discord.js";

import type { JournalService, JournalSession } from "./journal-service.js";
import type { JournalSummarizer } from "./journal-summarizer.js";

const POLL_INTERVAL_MS = 15_000;
const CLAIM_LIMIT = 5;
const INLINE_SUMMARY_LIMIT = 1_800;

function deliveryNonce(sessionId: number): string {
  return `yj-${sessionId}`;
}

export async function deliverJournalSummary(
  user: User,
  session: JournalSession,
  summary: string,
): Promise<void> {
  const window = `<t:${Math.floor(session.startedAt.getTime() / 1_000)}:f> to <t:${Math.floor(session.endsAt.getTime() / 1_000)}:f>`;
  const heading = `**Your Yapper journal summary**\n${window} - ${session.messageCount.toLocaleString("en-US")} messages`;
  const common = {
    allowedMentions: { parse: [] as never[] },
    nonce: deliveryNonce(session.id),
    enforceNonce: true,
  };

  if (heading.length + summary.length + 2 <= INLINE_SUMMARY_LIMIT) {
    await user.send({
      ...common,
      content: `${heading}\n\n${summary}`,
    });
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(summary, "utf8"), {
    name: `yapper-journal-${session.id}.md`,
    description: "Your private 24-hour Yapper activity summary",
  });
  await user.send({
    ...common,
    content: `${heading}\n\nYour summary is attached because it is longer than a Discord message.`,
    files: [attachment],
  });
}

export class JournalRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private readonly idleWaiters: Array<() => void> = [];

  public constructor(
    private readonly client: Client,
    private readonly service: JournalService,
    private readonly summarizer: JournalSummarizer,
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
    const sessions = await this.service.claimDue({ now, limit: CLAIM_LIMIT });
    let delivered = 0;

    for (const session of sessions) {
      try {
        let summary = session.summaryText;

        if (!summary) {
          const messages = await this.service.listMessages(session.id);
          summary = await this.summarizer.summarize({
            startedAt: session.startedAt,
            endsAt: session.endsAt,
            messages,
          });
          await this.service.saveSummary(session.id, summary);
        }

        const user = await this.client.users.fetch(session.userId);
        await deliverJournalSummary(user, session, summary);
        await this.service.markDelivered(session.id, new Date());
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.service.releaseForRetry({
          sessionId: session.id,
          error: message,
        });
        console.error(`Could not summarize or deliver journal ${session.id}:`, error);
      }
    }

    return delivered;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runOnce();
    } catch (error) {
      console.error("Journal delivery check failed:", error);
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
