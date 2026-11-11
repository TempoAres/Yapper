import {
  ChannelType,
  MessageType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildBasedChannel,
  type Message,
  type ThreadChannel,
} from "discord.js";

export interface AnalysisMessage {
  id: string;
  channelId: string;
  createdAt: Date;
  content: string;
  context?: { content: string; createdAt: Date; kind: "reply" | "preceding" };
}

export interface AnalysisHistory {
  startedAt: Date;
  endsAt: Date;
  messages: AnalysisMessage[];
  scannedChannels: number;
  skippedChannels: number;
  failedChannels: number;
  threadDiscoveryFailures: number;
}

function isHumanMessage(message: Message): boolean {
  return !message.author.bot && !message.webhookId && !message.system &&
    (message.type === MessageType.Default || message.type === MessageType.Reply);
}

function content(message: Message): string {
  // Files, URLs inside embeds, and linked pages are never downloaded.
  return [
    message.content.trim(),
    ...message.attachments.map(() => "[Attachment not analyzed]"),
    ...message.stickers.map((sticker) => `[Sticker: ${sticker.name}]`),
  ].filter(Boolean).join("\n") || "[No text content]";
}

function canRead(channel: GuildBasedChannel, bot: GuildMember): boolean {
  return channel.permissionsFor(bot)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
  ]) ?? false;
}

export type HistoryChannel = Extract<GuildBasedChannel, { messages: unknown }>;

/** Walk newest to oldest, keeping unresolved contexts across page boundaries. */
export async function collectChannelHistory(
  channel: HistoryChannel,
  userId: string,
  history: AnalysisHistory,
): Promise<void> {
  let before: string | undefined;
  let pending: AnalysisMessage[] = [];
  const seen = new Set<string>();

  while (true) {
    const page = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
      cache: false,
    });
    const messages = [...page.values()].sort((a, b) =>
      BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0,
    );
    if (messages.length === 0) return;

    for (const message of messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      if (message.createdAt >= history.endsAt) continue;

      if (isHumanMessage(message) && message.author.id !== userId) {
        for (const entry of pending) {
          entry.context = {
            content: content(message),
            createdAt: message.createdAt,
            kind: "preceding",
          };
        }
        pending = [];
      }

      if (message.createdAt < history.startedAt) {
        // An older message may still be the nearest other-person context.
        if (pending.length === 0) return;
        continue;
      }
      if (!isHumanMessage(message) || message.author.id !== userId) continue;

      const entry: AnalysisMessage = {
        id: message.id,
        channelId: channel.id,
        createdAt: message.createdAt,
        content: content(message),
      };
      history.messages.push(entry);

      if (message.reference?.messageId &&
          (!message.reference.channelId || message.reference.channelId === channel.id) &&
          (!message.reference.guildId || message.reference.guildId === channel.guild.id)) {
        try {
          const reply = await channel.messages.fetch({
            message: message.reference.messageId,
            cache: false,
            force: true,
          });
          if (isHumanMessage(reply) && reply.author.id !== userId &&
              reply.guildId === channel.guild.id && reply.channelId === channel.id) {
            entry.context = { content: content(reply), createdAt: reply.createdAt, kind: "reply" };
          }
        } catch {
          // Deleted/inaccessible replies fall back to the preceding human.
        }
      }
      if (!entry.context) pending.push(entry);
    }

    const oldest = messages.at(-1);
    if (!oldest || oldest.id === before) throw new Error("History pagination did not advance.");
    before = oldest.id;
  }
}

/** Includes active threads and paginated public/private archives, including forums. */
export async function collectAnalysisHistory(
  guild: Guild,
  userId: string,
  endsAt = new Date(),
): Promise<AnalysisHistory> {
  const history: AnalysisHistory = {
    startedAt: new Date(endsAt.getTime() - 30 * 24 * 60 * 60 * 1_000),
    endsAt,
    messages: [],
    scannedChannels: 0,
    skippedChannels: 0,
    failedChannels: 0,
    threadDiscoveryFailures: 0,
  };
  const bot = await guild.members.fetchMe();
  const channels = await guild.channels.fetch();
  const sources = new Map<string, GuildBasedChannel>();
  for (const channel of channels.values()) {
    if (channel) sources.set(channel.id, channel);
  }
  try {
    const active = await guild.channels.fetchActiveThreads(false);
    for (const thread of active.threads.values()) sources.set(thread.id, thread);
  } catch {
    history.threadDiscoveryFailures++;
  }

  for (const channel of channels.values()) {
    if (!channel || !("threads" in channel) || !canRead(channel, bot)) continue;
    const types: Array<"public" | "private"> = channel.type === ChannelType.GuildText
      ? ["public", "private"] : ["public"];
    for (const type of types) {
      const fetchAll = type === "private" &&
        (channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageThreads) ?? false);
      let before: Date | string | undefined;
      try {
        while (true) {
          const page = await channel.threads.fetchArchived({
            type, fetchAll, limit: 100, ...(before ? { before } : {}),
          }, false);
          const threads = [...page.threads.values()];
          for (const thread of threads) sources.set(thread.id, thread);
          if (!page.hasMore || threads.length === 0) break;
          // Joined private archives use a snowflake cursor; others use archive time.
          const oldest: ThreadChannel | undefined = type === "private" && !fetchAll
            ? threads.reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b)
            : threads.reduce((a, b) => (a.archiveTimestamp ?? Infinity) <
                (b.archiveTimestamp ?? Infinity) ? a : b);
          const next = type === "private" && !fetchAll ? oldest?.id : oldest?.archivedAt;
          if ((type === "public" || fetchAll) && oldest?.archivedAt &&
              oldest.archivedAt < history.startedAt) break;
          if (!next || String(next) === String(before)) {
            throw new Error("Archive pagination did not advance.");
          }
          before = next;
        }
      } catch {
        history.threadDiscoveryFailures++;
      }
    }
  }

  for (const channel of sources.values()) {
    if (!("messages" in channel)) continue;
    if (!canRead(channel, bot)) {
      history.skippedChannels++;
      continue;
    }
    try {
      await collectChannelHistory(channel, userId, history);
      history.scannedChannels++;
    } catch {
      // Preserve records already fetched, but make incomplete coverage explicit.
      history.failedChannels++;
    }
  }
  history.messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return history;
}
