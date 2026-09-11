import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OpenAiJournalSummarizer,
  splitJournalTranscript,
} from "../src/services/journal/journal-summarizer.js";
import type { JournalMessage } from "../src/services/journal/journal-service.js";

const messages: JournalMessage[] = [
  {
    messageId: "1",
    channelId: "10",
    channelName: "general",
    content: "Finished the report.",
    createdAt: new Date("2026-09-02T10:00:00.000Z"),
  },
  {
    messageId: "2",
    channelId: "11",
    channelName: "projects",
    content: "Tomorrow I need to send it.",
    createdAt: new Date("2026-09-02T11:00:00.000Z"),
  },
];

describe("OpenAI journal summarizer", () => {
  it("keeps messages ordered while splitting large transcripts", () => {
    const chunks = splitJournalTranscript(messages, 80);

    assert.equal(chunks.length, 2);
    assert.match(chunks[0] ?? "", /Finished the report/);
    assert.match(chunks[1] ?? "", /Tomorrow I need to send it/);
  });

  it("labels and deduplicates another person's context inside a transcript chunk", () => {
    const contextMessage = {
      messageId: "context-1",
      content: "Did the Minecraft build get finished?",
      createdAt: new Date("2026-09-02T09:59:00.000Z"),
    };
    const chunks = splitJournalTranscript(
      messages.map((message) => ({ ...message, contextMessage })),
      10_000,
    );
    const transcript = chunks.join("\n");

    assert.equal(
      transcript.match(/Did the Minecraft build get finished\?/g)?.length,
      1,
    );
    assert.match(transcript, /conversation_context_reference_only/);
    assert.match(transcript, /same_context_as_previous_author_message/);
    assert.equal(transcript.match(/journal_author_message/g)?.length, 2);
  });

  it("uses the Responses API without server-side response storage", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const request = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "## Overview\nProductive day." }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const summarizer = new OpenAiJournalSummarizer(
      "test-key",
      "gpt-5.6-luna",
      request as typeof fetch,
    );

    const summary = await summarizer.summarizeDaily({
      startedAt: new Date("2026-09-02T00:00:00.000Z"),
      endsAt: new Date("2026-09-03T00:00:00.000Z"),
      messages: [
        {
          ...messages[0]!,
          contextMessage: {
            messageId: "context-1",
            content: "Were you able to finish the report?",
            createdAt: new Date("2026-09-02T09:59:00.000Z"),
          },
        },
        messages[1]!,
      ],
    });
    const body = JSON.parse(String(requests[0]?.init.body)) as {
      model: string;
      store: boolean;
      input: string;
      instructions: string;
      reasoning: { effort: string };
    };

    assert.equal(summary, "## Overview\nProductive day.");
    assert.equal(requests[0]?.url, "https://api.openai.com/v1/responses");
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, "none");
    assert.match(body.input, /Finished the report/);
    assert.match(body.input, /Were you able to finish the report/);
    assert.match(body.input, /conversation_context_reference_only/);
    assert.match(body.instructions, /untrusted quoted data/i);
    assert.match(body.instructions, /Summarize only records whose kind is journal_author_message/i);
    assert.match(body.instructions, /never attribute them to the author/i);
    assert.match(body.instructions, /800 characters/i);
    assert.equal(
      (requests[0]?.init.headers as Record<string, string>).Authorization,
      "Bearer test-key",
    );
  });

  it("creates the weekly retro only from retained daily retros", async () => {
    const requests: RequestInit[] = [];
    const request = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "## Week in review\nSolid progress." }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const summarizer = new OpenAiJournalSummarizer(
      "test-key",
      "gpt-5.6-luna",
      request as typeof fetch,
    );

    const summary = await summarizer.summarizeWeekly({
      startedAt: new Date("2026-08-31T22:00:00.000Z"),
      endsAt: new Date("2026-09-06T22:00:00.000Z"),
      dailySummaries: [
        {
          startedAt: new Date("2026-08-31T22:00:00.000Z"),
          endsAt: new Date("2026-09-01T22:00:00.000Z"),
          summaryText: "Finished the first milestone.",
        },
      ],
    });
    const body = JSON.parse(String(requests[0]?.body)) as {
      input: string;
      instructions: string;
      max_output_tokens: number;
    };

    assert.match(summary, /Week in review/);
    assert.match(body.input, /Finished the first milestone/);
    assert.match(body.instructions, /weekly self-productivity retro/i);
    assert.match(body.instructions, /3,900 characters/i);
    assert.equal(body.max_output_tokens, 1_400);
  });

  it("creates a distinct public-safe Minecraft weekly update", async () => {
    const requests: RequestInit[] = [];
    const request = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "## Minecraft\nI made steady progress on the server.",
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const summarizer = new OpenAiJournalSummarizer(
      "test-key",
      "gpt-5.6-luna",
      request as typeof fetch,
    );

    const summary = await summarizer.summarizePublicWeekly({
      startedAt: new Date("2026-08-31T22:00:00.000Z"),
      endsAt: new Date("2026-09-06T22:00:00.000Z"),
      dailySummaries: [
        {
          startedAt: new Date("2026-08-31T22:00:00.000Z"),
          endsAt: new Date("2026-09-01T22:00:00.000Z"),
          summaryText: "Worked on a Minecraft build and handled a private matter.",
        },
      ],
    });
    const body = JSON.parse(String(requests[0]?.body)) as {
      input: string;
      instructions: string;
      max_output_tokens: number;
      store: boolean;
    };

    assert.match(summary, /Minecraft/);
    assert.match(body.input, /Minecraft build/);
    assert.match(body.instructions, /public weekly Discord update/i);
    assert.match(body.instructions, /Focus mainly on grounded Minecraft/i);
    assert.match(body.instructions, /Omit private conversations/i);
    assert.match(body.instructions, /Do not reveal.*language model/i);
    assert.equal(body.max_output_tokens, 1_400);
    assert.equal(body.store, false);
  });
});
