import {
  Client,
  Events,
  MessageType,
  escapeMarkdown,
  type GuildMember,
  type Message,
  type MessageCreateOptions,
} from "discord.js";

import {
  normalizeAfkReason,
  type AfkService,
  type AfkStatus,
} from "../services/afk/afk-service.js";

const AFK_NICKNAME_PREFIX = "[AFK] ";
const MAX_DISCORD_NICKNAME_LENGTH = 32;

export interface ParsedAfkCommand {
  reason: string;
}

export function isAfkCommand(content: string): boolean {
  return /^\?afk(?:\s|$)/iu.test(content);
}

export function parseAfkCommand(content: string): ParsedAfkCommand | undefined {
  if (!isAfkCommand(content)) {
    return undefined;
  }

  return { reason: normalizeAfkReason(content.slice(4)) };
}

export function createAfkNickname(displayName: string): string {
  if (displayName.startsWith(AFK_NICKNAME_PREFIX)) {
    return [...displayName].slice(0, MAX_DISCORD_NICKNAME_LENGTH).join("");
  }

  const available = MAX_DISCORD_NICKNAME_LENGTH - AFK_NICKNAME_PREFIX.length;
  return `${AFK_NICKNAME_PREFIX}${[...displayName].slice(0, available).join("")}`;
}

function isSupportedUserMessage(message: Message): message is Message<true> {
  return (
    message.inGuild() &&
    !message.author.bot &&
    message.webhookId === null &&
    !message.system &&
    (message.type === MessageType.Default || message.type === MessageType.Reply)
  );
}

function afkConfirmation(reason: string): MessageCreateOptions {
  return {
    content: `You're now AFK: **${escapeMarkdown(reason)}**`,
    allowedMentions: { parse: [] },
  };
}

function welcomeBack(userId: string): MessageCreateOptions {
  return {
    content: `Welcome back, <@${userId}>! I removed your AFK status.`,
    allowedMentions: { parse: [], users: [userId] },
  };
}

export function createAfkMentionNotice(
  statuses: readonly AfkStatus[],
): MessageCreateOptions | undefined {
  if (statuses.length === 0) {
    return undefined;
  }

  const lines: string[] = [];

  for (const status of statuses) {
    const unixTime = Math.floor(status.setAt.getTime() / 1_000);
    const line = `<@${status.userId}> is AFK: **${escapeMarkdown(status.reason)}** • since <t:${unixTime}:R>`;
    const remaining = statuses.length - lines.length;
    const overflow = remaining > 1 ? `\n…and ${remaining - 1} more.` : "";

    if ([...lines, line].join("\n").length + overflow.length > 1_950) {
      lines.push(`…and ${remaining} more AFK member${remaining === 1 ? "" : "s"}.`);
      break;
    }

    lines.push(line);
  }

  return {
    content: lines.join("\n"),
    allowedMentions: { parse: [] },
  };
}

async function applyAfkNickname(
  member: GuildMember | null,
  existing: AfkStatus | undefined,
): Promise<{
  originalNickname: string | null;
  appliedNickname: string | null;
  changed: boolean;
}> {
  const originalNickname = existing?.originalNickname ?? member?.nickname ?? null;

  if (!member) {
    return {
      originalNickname,
      appliedNickname: existing?.appliedNickname ?? null,
      changed: false,
    };
  }

  const desiredNickname = createAfkNickname(member.displayName);

  if (member.nickname === desiredNickname) {
    return {
      originalNickname,
      appliedNickname: desiredNickname,
      changed: false,
    };
  }

  if (!member.manageable) {
    return { originalNickname, appliedNickname: null, changed: false };
  }

  try {
    await member.setNickname(desiredNickname, "Yapper AFK status set");
    return {
      originalNickname,
      appliedNickname: desiredNickname,
      changed: true,
    };
  } catch (error) {
    console.warn(
      `Could not add the AFK nickname for guild ${member.guild.id}, member ${member.id}:`,
      error,
    );
    return { originalNickname, appliedNickname: null, changed: false };
  }
}

async function restoreAfkNickname(
  member: GuildMember | null,
  status: AfkStatus,
): Promise<void> {
  if (
    !member?.manageable ||
    status.appliedNickname === null ||
    member.nickname !== status.appliedNickname
  ) {
    return;
  }

  try {
    await member.setNickname(
      status.originalNickname,
      "Yapper AFK status cleared",
    );
  } catch (error) {
    console.warn(
      `Could not restore the nickname for guild ${status.guildId}, member ${status.userId}:`,
      error,
    );
  }
}

export async function handleAfkMessage(
  message: Message,
  afkService: AfkService,
): Promise<boolean> {
  if (!isSupportedUserMessage(message)) {
    return false;
  }

  let command: ParsedAfkCommand | undefined;

  try {
    command = parseAfkCommand(message.content);
  } catch (error) {
    if (error instanceof RangeError) {
      await message.channel.send({
        content: error.message,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    throw error;
  }

  if (command) {
    const existing = await afkService.getAfk(
      message.guildId,
      message.author.id,
    );
    const nickname = await applyAfkNickname(message.member, existing);

    try {
      await afkService.setAfk({
        guildId: message.guildId,
        userId: message.author.id,
        reason: command.reason,
        setAt: message.createdAt,
        originalNickname: nickname.originalNickname,
        appliedNickname: nickname.appliedNickname,
      });
    } catch (error) {
      if (nickname.changed && message.member?.manageable) {
        try {
          await message.member.setNickname(
            nickname.originalNickname,
            "Yapper AFK status could not be saved",
          );
        } catch (restoreError) {
          console.warn(
            `Could not roll back the AFK nickname for guild ${message.guildId}, member ${message.author.id}:`,
            restoreError,
          );
        }
      }

      throw error;
    }

    await message.channel.send(afkConfirmation(command.reason));
    return true;
  }

  const cleared = await afkService.clearAfkIfReady(
    message.guildId,
    message.author.id,
    message.createdAt,
  );

  if (cleared) {
    await restoreAfkNickname(message.member, cleared);
    await message.channel.send(welcomeBack(message.author.id));
  }

  const mentionedUserIds = [...message.mentions.users.keys()].filter(
    (userId) => userId !== message.author.id,
  );
  const statuses = await afkService.getAfkForUsers(
    message.guildId,
    mentionedUserIds,
  );
  const notice = createAfkMentionNotice(statuses);

  if (notice) {
    await message.channel.send(notice);
  }

  return Boolean(cleared || notice);
}

export function registerAfkListener(
  client: Client,
  afkService: AfkService,
): void {
  client.on(Events.MessageCreate, (message) => {
    void handleAfkMessage(message, afkService).catch((error: unknown) => {
      console.error(
        `Could not process AFK state for guild ${message.guildId}, message ${message.id}:`,
        error,
      );
    });
  });
}
