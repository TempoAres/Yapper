import { Client, Events, type Message } from "discord.js";

import { CalculatorExpressionError, calculateExpression } from "../services/calculator.js";
export { CalculatorExpressionError, calculateExpression } from "../services/calculator.js";

export function isCalculatorCommand(content: string): boolean {
  return /^\?calc(?:\s|$)/iu.test(content);
}

export function formatCalculationResult(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CalculatorExpressionError("The result is too large to display.");
  }

  if (Object.is(value, -0)) {
    return "0";
  }

  return Number.parseFloat(value.toPrecision(15)).toString();
}

export function createCalculatorSyntaxHelp(): {
  content: string;
  allowedMentions: { parse: [] };
} {
  return {
    content: [
      "**Calculator syntax**",
      "Use `?calc <expression>`",
      "Operators: `+` add · `-` subtract · `*` multiply · `/` divide · `^` exponent",
      "Other: `pi`, decimal points, and parentheses `( )`",
      "Order: parentheses → exponents → multiplication/division → addition/subtraction",
      "Examples: `?calc 2 + 3 * pi` · `?calc (10 - 2) / 4` · `?calc 5 ^ 2`",
    ].join("\n"),
    allowedMentions: { parse: [] },
  };
}

export async function handleCalculatorMessage(
  message: Message,
): Promise<boolean> {
  if (
    !message.inGuild() ||
    message.author.bot ||
    message.webhookId !== null ||
    !isCalculatorCommand(message.content)
  ) {
    return false;
  }

  const expression = message.content.slice(5).trim();

  if (!expression) {
    await message.channel.send(createCalculatorSyntaxHelp());
    return true;
  }

  try {
    const result = formatCalculationResult(calculateExpression(expression));
    await message.channel.send({
      content: `**Result:** \`${result}\``,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (!(error instanceof CalculatorExpressionError)) {
      throw error;
    }

    await message.channel.send({
      content: `${error.message} Try something like \`?calc 2 + 3 * pi\` or \`?calc 5 ^ 2\`.`,
      allowedMentions: { parse: [] },
    });
  }

  return true;
}

export function registerCalculatorListener(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void handleCalculatorMessage(message).catch((error: unknown) => {
      console.error(
        `Could not calculate an expression for guild ${message.guildId}, message ${message.id}:`,
        error,
      );
    });
  });
}
