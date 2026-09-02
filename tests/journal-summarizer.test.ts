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

    const summary = await summarizer.summarize({
      startedAt: new Date("2026-09-02T00:00:00.000Z"),
      endsAt: new Date("2026-09-03T00:00:00.000Z"),
      messages,
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
    assert.match(body.instructions, /untrusted quoted data/i);
    assert.equal(
      (requests[0]?.init.headers as Record<string, string>).Authorization,
      "Bearer test-key",
    );
  });
});
