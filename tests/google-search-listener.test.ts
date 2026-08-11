import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "discord.js";

import {
  createGoogleSearchUrl,
  handleGoogleSearchMessage,
  isGoogleSearchCommand,
} from "../src/bot/google-search-listener.js";

function fakeMessage(input: {
  content: string;
  authorIsBot?: boolean;
  webhookId?: string | null;
  sent: unknown[];
}): Message {
  return {
    inGuild: () => true,
    author: { bot: input.authorIsBot ?? false },
    webhookId: input.webhookId ?? null,
    content: input.content,
    channel: {
      send: async (response: unknown) => {
        input.sent.push(response);
      },
    },
  } as unknown as Message;
}

describe("Google query listener", () => {
  it("converts everything after ?g into a lowercase Google search URL", () => {
    assert.equal(
      createGoogleSearchUrl("?g Eiffel Tower"),
      "https://www.google.com/search?q=eiffel+tower",
    );
    assert.equal(
      createGoogleSearchUrl("?G C++ & TypeScript"),
      "https://www.google.com/search?q=c%2B%2B+%26+typescript",
    );
  });

  it("ignores empty queries and messages that do not start with ?g", () => {
    assert.equal(isGoogleSearchCommand("?g"), true);
    assert.equal(isGoogleSearchCommand("hello ?g Eiffel Tower"), false);
    assert.equal(createGoogleSearchUrl("?g   "), null);
    assert.equal(createGoogleSearchUrl("hello ?g Eiffel Tower"), null);
    assert.equal(createGoogleSearchUrl("?google"), null);
  });

  it("sends only the generated URL for eligible server messages", async () => {
    const sent: unknown[] = [];
    const handled = await handleGoogleSearchMessage(
      fakeMessage({ content: "?g Eiffel Tower", sent }),
    );

    assert.equal(handled, true);
    assert.deepEqual(sent, [
      {
        content: "https://www.google.com/search?q=eiffel+tower",
        allowedMentions: { parse: [] },
      },
    ]);
  });

  it("ignores bot and webhook messages", async () => {
    const sent: unknown[] = [];

    assert.equal(
      await handleGoogleSearchMessage(
        fakeMessage({ content: "?g test", authorIsBot: true, sent }),
      ),
      false,
    );
    assert.equal(
      await handleGoogleSearchMessage(
        fakeMessage({ content: "?g test", webhookId: "webhook-1", sent }),
      ),
      false,
    );
    assert.deepEqual(sent, []);
  });
});
