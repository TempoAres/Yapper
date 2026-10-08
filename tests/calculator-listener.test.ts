import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "discord.js";

import {
  CalculatorExpressionError,
  calculateExpression,
  createCalculatorSyntaxHelp,
  formatCalculationResult,
  handleCalculatorMessage,
  isCalculatorCommand,
} from "../src/bot/calculator-listener.js";

function fakeMessage(input: {
  content: string;
  sent: unknown[];
  authorIsBot?: boolean;
  webhookId?: string | null;
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

describe("calculator listener", () => {
  it("recognizes only the complete ?calc prefix", () => {
    assert.equal(isCalculatorCommand("?calc 2 + 2"), true);
    assert.equal(isCalculatorCommand("?CALC pi"), true);
    assert.equal(isCalculatorCommand("?calculator 2 + 2"), false);
    assert.equal(isCalculatorCommand("hello ?calc 2 + 2"), false);
  });

  it("uses normal operator precedence and left associativity", () => {
    assert.equal(calculateExpression("2 + 3 * 4"), 14);
    assert.equal(calculateExpression("2 + 3 ^ 2 * 4"), 38);
    assert.equal(calculateExpression("20 / 5 * 2"), 8);
    assert.equal(calculateExpression("20 - 5 - 3"), 12);
  });

  it("supports right-associative exponents and signed powers", () => {
    assert.equal(calculateExpression("5 ^ 2"), 25);
    assert.equal(calculateExpression("2 ^ 3 ^ 2"), 512);
    assert.equal(calculateExpression("-2 ^ 2"), -4);
    assert.equal(calculateExpression("(-2) ^ 2"), 4);
    assert.equal(calculateExpression("2 ^ -2"), 0.25);
    assert.equal(calculateExpression("9 ^ .5"), 3);
  });

  it("supports pi, parentheses, decimals, and unary signs", () => {
    assert.equal(calculateExpression("2 * pi"), 2 * Math.PI);
    assert.equal(calculateExpression("-(2 + 3) * .5"), -2.5);
    assert.equal(calculateExpression("+4. / 2"), 2);
  });

  it("formats floating-point results cleanly", () => {
    assert.equal(
      formatCalculationResult(calculateExpression("0.1 + 0.2")),
      "0.3",
    );
    assert.equal(formatCalculationResult(-0), "0");
  });

  it("rejects unsafe or malformed calculations", () => {
    assert.throws(
      () => calculateExpression("1 / 0"),
      /Division by zero/,
    );
    assert.throws(() => calculateExpression("2 +"), CalculatorExpressionError);
    assert.throws(
      () => calculateExpression("process.exit()"),
      CalculatorExpressionError,
    );
    assert.throws(() => calculateExpression("2 ** 3"), CalculatorExpressionError);
  });

  it("responds with only the calculated result and suppresses mentions", async () => {
    const sent: unknown[] = [];

    assert.equal(
      await handleCalculatorMessage(
        fakeMessage({ content: "?calc 2 + 3 * pi", sent }),
      ),
      true,
    );
    assert.deepEqual(sent, [
      {
        content: `**Result:** \`${formatCalculationResult(2 + 3 * Math.PI)}\``,
        allowedMentions: { parse: [] },
      },
    ]);
  });

  it("shows general syntax tips when ?calc has no expression", async () => {
    const sent: unknown[] = [];

    assert.equal(
      await handleCalculatorMessage(fakeMessage({ content: "?calc   ", sent })),
      true,
    );
    assert.deepEqual(sent, [createCalculatorSyntaxHelp()]);
    const help = createCalculatorSyntaxHelp().content;
    assert.match(help, /`\^` exponent/);
    assert.match(help, /parentheses → exponents → multiplication\/division/);
    assert.match(help, /`\?calc 5 \^ 2`/);
  });

  it("returns a useful example for an invalid expression", async () => {
    const sent: unknown[] = [];

    await handleCalculatorMessage(
      fakeMessage({ content: "?calc 2 / 0", sent }),
    );

    assert.deepEqual(sent, [
      {
        content:
          "Division by zero is not allowed. Try something like `?calc 2 + 3 * pi` or `?calc 5 ^ 2`.",
        allowedMentions: { parse: [] },
      },
    ]);
  });

  it("ignores bot and webhook messages", async () => {
    const sent: unknown[] = [];

    assert.equal(
      await handleCalculatorMessage(
        fakeMessage({ content: "?calc 2 + 2", sent, authorIsBot: true }),
      ),
      false,
    );
    assert.equal(
      await handleCalculatorMessage(
        fakeMessage({ content: "?calc 2 + 2", sent, webhookId: "hook-1" }),
      ),
      false,
    );
    assert.deepEqual(sent, []);
  });
});
