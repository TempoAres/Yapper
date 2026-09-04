import { EmbedBuilder, type Client, type User } from "discord.js";

import type {
  JournalRetainedSummary,
  JournalService,
  JournalSession,
} from "./journal-service.js";
import type { JournalSummarizer } from "./journal-summarizer.js";
import { yapperColors } from "../../presentation/colors.js";
import { localMidnightDaysFrom } from "../leaderboards/leaderboard-period.js";

const POLL_INTERVAL_MS = 15_000;
const CLAIM_LIMIT = 5;
export const DAILY_MESSAGE_CHARACTER_LIMIT = 1_000;
export const WEEKLY_SUMMARY_CHARACTER_LIMIT = 4_000;
const EMBED_DESCRIPTION_CHARACTER_LIMIT = 4_096;

function deliveryNonce(sessionId: number): string {
  return `yj-${sessionId}`;
}

function discordTimestamp(date: Date, style: "d" | "f"): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

export function truncateJournalText(text: string, maximumCharacters: number): string {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new RangeError("Journal text limit must be a positive whole number.");
  }

  const normalized = text.trim();

  if (normalized.length <= maximumCharacters) {
    return normalized;
  }

  const available = maximumCharacters - 1;
  const candidate = normalized.slice(0, available);
  const naturalBreak = Math.max(
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf(" "),
  );
  const cutoff = naturalBreak >= available - 80 ? naturalBreak : available;
  return `${candidate.slice(0, cutoff).trimEnd()}…`;
}

export function isWeeklyJournalBoundary(date: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;

  return (
    value("weekday") === "Mon" &&
    value("hour") === "00" &&
    value("minute") === "00" &&
    value("second") === "00"
  );
}

function dailyHeading(session: JournalSession): string {
  const window = `${discordTimestamp(session.startedAt, "f")} – ${discordTimestamp(session.endsAt, "f")}`;
  return `**Your daily Yapper retro**\n${window} • ${session.messageCount.toLocaleString("en-US")} messages`;
}

export function fitDailySummary(session: JournalSession, summary: string): string {
  const available = DAILY_MESSAGE_CHARACTER_LIMIT - dailyHeading(session).length - 2;
  return truncateJournalText(summary, available);
}

export async function deliverDailyJournalSummary(
  user: User,
  session: JournalSession,
  summary: string,
): Promise<void> {
  const heading = dailyHeading(session);
  await user.send({
    content: `${heading}\n\n${fitDailySummary(session, summary)}`,
    allowedMentions: { parse: [] as never[] },
    nonce: deliveryNonce(session.id),
    enforceNonce: true,
  });
}

export async function deliverWeeklyJournalSummary(
  user: User,
  session: JournalSession,
  weekStartedAt: Date,
  summary: string,
): Promise<void> {
  const window = `${discordTimestamp(weekStartedAt, "d")} – ${discordTimestamp(session.endsAt, "d")}`;
  const maximumSummaryLength = Math.min(
    WEEKLY_SUMMARY_CHARACTER_LIMIT,
    EMBED_DESCRIPTION_CHARACTER_LIMIT - window.length - 2,
  );
  const embed = new EmbedBuilder()
    .setColor(yapperColors.violet)
    .setTitle("Your weekly Yapper retro")
    .setDescription(
      `${window}\n\n${truncateJournalText(summary, maximumSummaryLength)}`,
    )
    .setFooter({ text: "Monday–Sunday" })
    .setTimestamp(session.endsAt);

  await user.send({
    embeds: [embed],
    allowedMentions: { parse: [] as never[] },
    nonce: deliveryNonce(session.id),
    enforceNonce: true,
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
    private readonly timezone: string,
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
        const weekly = isWeeklyJournalBoundary(session.endsAt, this.timezone);
        const weekStartedAt = weekly
          ? localMidnightDaysFrom(session.endsAt, this.timezone, -7)
          : undefined;
        const retainedSummaries = weekly
          ? await this.service.listRetainedSummaries({
              guildId: session.guildId,
              userId: session.userId,
              from: weekStartedAt ?? session.startedAt,
              through: session.endsAt,
            })
          : [];
        let summary = session.summaryText;

        if (!summary) {
          const messages = await this.service.listMessages(session.id);
          const dailySummary = fitDailySummary(
            session,
            await this.summarizer.summarizeDaily({
              startedAt: session.startedAt,
              endsAt: session.endsAt,
              messages,
            }),
          );

          if (weekly) {
            const weeklyInputs: JournalRetainedSummary[] = [
              ...retainedSummaries,
              {
                startedAt: session.startedAt,
                endsAt: session.endsAt,
                summaryText: dailySummary,
              },
            ];
            summary = truncateJournalText(
              await this.summarizer.summarizeWeekly({
                startedAt: weekStartedAt ?? session.startedAt,
                endsAt: session.endsAt,
                dailySummaries: weeklyInputs,
              }),
              WEEKLY_SUMMARY_CHARACTER_LIMIT,
            );
          } else {
            summary = dailySummary;
          }

          await this.service.saveSummary(session.id, summary);
        }

        const user = await this.client.users.fetch(session.userId);

        if (weekly) {
          await deliverWeeklyJournalSummary(
            user,
            session,
            weekStartedAt ?? session.startedAt,
            summary,
          );
        } else {
          await deliverDailyJournalSummary(user, session, summary);
        }

        await this.service.markDelivered({
          sessionId: session.id,
          deliveredAt: new Date(),
          clearRetainedSummaries: weekly,
        });
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
