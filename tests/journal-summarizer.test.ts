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

  it("pairs every owner message with explicitly non-summarizable context", () => {
    const contextMessage = {
      messageId: "context-1",
      content: "Did the Minecraft build get finished?",
      createdAt: new Date("2026-09-02T09:59:00.000Z"),
    };
    const chunks = splitJournalTranscript(
      messages.map((message) => ({ ...message, contextMessage })),
      10_000,
    );
    const entries = chunks
      .join("\n")
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const firstContext = entries[0]?.other_person_context as
      | Record<string, unknown>
      | undefined;
    const firstOwnerMessage = entries[0]?.journal_owner_message as
      | Record<string, unknown>
      | undefined;

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.summary_subject, "JOURNAL_OWNER_ONLY");
    assert.equal(firstContext?.speaker, "OTHER_PERSON_CONTEXT_ONLY");
    assert.equal(firstContext?.summarize, false);
    assert.equal(
      firstContext?.purpose,
      "topic_context_for_paired_owner_message_only",
    );
    assert.equal(firstOwnerMessage?.speaker, "JOURNAL_OWNER");
    assert.equal(firstOwnerMessage?.summarize, true);
    assert.equal(
      entries.filter((entry) => "other_person_context" in entry).length,
      2,
    );
  });

  it("marks another person's accomplishment as context rather than owner evidence", () => {
    const [transcript] = splitJournalTranscript([
      {
        messageId: "owner-reply",
        channelId: "10",
        channelName: "general",
        content: "That looks fantastic, congratulations!",
        createdAt: new Date("2026-09-02T10:01:00.000Z"),
        contextMessage: {
          messageId: "other-accomplishment",
          content: "I finished rebuilding the entire Minecraft castle today.",
          createdAt: new Date("2026-09-02T10:00:00.000Z"),
        },
      },
    ]);
    const entry = JSON.parse(transcript ?? "{}") as {
      summary_subject?: string;
      other_person_context?: { speaker?: string; summarize?: boolean; content?: string };
      journal_owner_message?: { speaker?: string; summarize?: boolean; content?: string };
    };

    assert.equal(entry.summary_subject, "JOURNAL_OWNER_ONLY");
    assert.deepEqual(entry.other_person_context, {
      speaker: "OTHER_PERSON_CONTEXT_ONLY",
      summarize: false,
      purpose: "topic_context_for_paired_owner_message_only",
      message_id: "other-accomplishment",
      timestamp: "2026-09-02T10:00:00.000Z",
      channel: "general",
      content: "I finished rebuilding the entire Minecraft castle today.",
    });
    assert.equal(entry.journal_owner_message?.speaker, "JOURNAL_OWNER");
    assert.equal(entry.journal_owner_message?.summarize, true);
    assert.equal(
      entry.journal_owner_message?.content,
      "That looks fantastic, congratulations!",
    );
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
    assert.match(body.input, /OTHER_PERSON_CONTEXT_ONLY/);
    assert.match(body.input, /JOURNAL_OWNER_ONLY/);
    assert.match(body.input, /"summarize":false/);
    assert.match(body.input, /"summarize":true/);
    assert.match(body.instructions, /untrusted quoted data/i);
    assert.match(body.instructions, /JOURNAL_OWNER is the only summary subject/i);
    assert.match(body.instructions, /context-only message is never evidence/i);
    assert.match(body.instructions, /If ownership is ambiguous, omit the claim/i);
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
