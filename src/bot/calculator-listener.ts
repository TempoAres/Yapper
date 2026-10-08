import { Client, Events, type Message } from "discord.js";

const MAX_EXPRESSION_LENGTH = 200;

export class CalculatorExpressionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CalculatorExpressionError";
  }
}

class ExpressionParser {
  private index = 0;

  public constructor(private readonly expression: string) {}

  public parse(): number {
    const result = this.parseExpression();
    this.skipWhitespace();

    if (this.index !== this.expression.length) {
      throw new CalculatorExpressionError(
        `Unexpected character “${this.expression[this.index]}”.`,
      );
    }

    return result;
  }

  private parseExpression(): number {
    let value = this.parseTerm();

    while (true) {
      this.skipWhitespace();
      const operator = this.expression[this.index];

      if (operator !== "+" && operator !== "-") {
        return value;
      }

      this.index += 1;
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
      this.assertFinite(value);
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();

    while (true) {
      this.skipWhitespace();
      const operator = this.expression[this.index];

      if (operator !== "*" && operator !== "/") {
        return value;
      }

      this.index += 1;
      const right = this.parseFactor();

      if (operator === "/" && right === 0) {
        throw new CalculatorExpressionError("Division by zero is not allowed.");
      }

      value = operator === "*" ? value * right : value / right;
      this.assertFinite(value);
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();
    const operator = this.expression[this.index];

    if (operator === "+" || operator === "-") {
      this.index += 1;
      const value = this.parseFactor();
      return operator === "-" ? -value : value;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.expression[this.index] === "(") {
      this.index += 1;
      const value = this.parseExpression();
      this.skipWhitespace();

      if (this.expression[this.index] !== ")") {
        throw new CalculatorExpressionError("A closing parenthesis is missing.");
      }

      this.index += 1;
      return value;
    }

    if (this.expression.slice(this.index, this.index + 2).toLowerCase() === "pi") {
      this.index += 2;
      return Math.PI;
    }

    const numberMatch = /^(?:\d+(?:\.\d*)?|\.\d+)/u.exec(
      this.expression.slice(this.index),
    );

    if (!numberMatch) {
      throw new CalculatorExpressionError(
        this.index >= this.expression.length
          ? "The expression ends before a number, pi, or parenthesis."
          : `Expected a number, pi, or parenthesis at “${this.expression.slice(this.index, this.index + 12)}”.`,
      );
    }

    this.index += numberMatch[0].length;
    const value = Number(numberMatch[0]);
    this.assertFinite(value);
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.expression[this.index] ?? "")) {
      this.index += 1;
    }
  }

  private assertFinite(value: number): void {
    if (!Number.isFinite(value)) {
      throw new CalculatorExpressionError("The result is too large to display.");
    }
  }
}

export function isCalculatorCommand(content: string): boolean {
  return /^\?calc(?:\s|$)/iu.test(content);
}

export function calculateExpression(expression: string): number {
  const normalized = expression.normalize("NFKC").trim();

  if (normalized.length === 0) {
    throw new CalculatorExpressionError("Please provide a calculation.");
  }

  if (normalized.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorExpressionError(
      `Calculations can contain at most ${MAX_EXPRESSION_LENGTH} characters.`,
    );
  }

  return new ExpressionParser(normalized).parse();
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

  try {
    const expression = message.content.slice(5);
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
      content: `${error.message} Try something like \`?calc 2 + 3 * pi\`.`,
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
