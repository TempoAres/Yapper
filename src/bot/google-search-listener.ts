import { Client, Events, type Message } from "discord.js";

export function isGoogleSearchCommand(content: string): boolean {
  return /^\?g(?:\s|$)/i.test(content);
}

export function createGoogleSearchUrl(content: string): string | null {
  if (!isGoogleSearchCommand(content)) {
    return null;
  }

  const query = content.slice(2).trim();

  if (!query) {
    return null;
  }

  const parameters = new URLSearchParams({ q: query.toLowerCase() });
  return `https://www.google.com/search?${parameters.toString()}`;
}

export async function handleGoogleSearchMessage(
  message: Message,
): Promise<boolean> {
  if (!message.inGuild() || message.author.bot || message.webhookId !== null) {
    return false;
  }

  const url = createGoogleSearchUrl(message.content);

  if (!url) {
    return false;
  }

  await message.channel.send({
    content: url,
    allowedMentions: { parse: [] },
  });
  return true;
}

export function registerGoogleSearchListener(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void handleGoogleSearchMessage(message).catch((error: unknown) => {
      console.error(
        `Could not create a Google link for guild ${message.guildId}, message ${message.id}:`,
        error,
      );
    });
  });
}
