export interface Mee6FetchedXpRow {
  userId: string;
  rawXp: number;
}

export interface Mee6FetchResult {
  guildId: string;
  guildName: string;
  rows: Mee6FetchedXpRow[];
  pagesFetched: number;
}

export type Mee6FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface Mee6FetchOptions {
  guildId: string;
  fetchImpl?: Mee6FetchFunction;
  pageSize?: number;
  pageDelayMilliseconds?: number;
  retryDelay?: (milliseconds: number) => Promise<void>;
  onPageFetched?: (page: number, rowCount: number) => void;
}

const DISCORD_ID = /^\d{17,20}$/;
const MAX_PAGES = 100;
const MAX_ROWS = 100_000;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.min(Math.ceil(Number(retryAfter) * 1_000), 10_000);
  }

  return Math.min(500 * 2 ** attempt, 10_000);
}

async function requestPage(
  fetchImpl: Mee6FetchFunction,
  guildId: string,
  page: number,
  pageSize: number,
  retryDelay: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  const url = new URL(
    `https://mee6.xyz/api/plugins/levels/leaderboard/${guildId}`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(pageSize));
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MILLISECONDS,
    );
    let response: Response;

    try {
      response = await fetchImpl(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "Yapper-Legacy-XP-Migration/1.0",
        },
        signal: controller.signal,
      });
    } catch (error) {
      lastNetworkError = error;
      clearTimeout(timeout);

      if (attempt + 1 < MAX_ATTEMPTS) {
        await retryDelay(500 * 2 ** attempt);
        continue;
      }

      break;
    }

    clearTimeout(timeout);

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new Error(`MEE6 page ${page} returned invalid JSON.`);
      }
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt + 1 < MAX_ATTEMPTS
    ) {
      await retryDelay(parseRetryDelay(response, attempt));
      continue;
    }

    const responseText = (await response.text()).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(
      `MEE6 page ${page} failed with HTTP ${response.status}${responseText ? `: ${responseText}` : "."}`,
    );
  }

  const detail =
    lastNetworkError instanceof Error ? ` ${lastNetworkError.message}` : "";
  throw new Error(`Could not reach MEE6 for page ${page} after ${MAX_ATTEMPTS} attempts.${detail}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or malformed.`);
  }

  return value as Record<string, unknown>;
}

function parseRawXp(value: unknown, page: number, userId: string): number {
  const rawValue = typeof value === "number" ? String(value) : value;

  if (typeof rawValue !== "string" || !/^\d+$/.test(rawValue)) {
    throw new Error(`MEE6 page ${page} has invalid XP for user ${userId}.`);
  }

  const parsed = Number(rawValue);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`MEE6 XP for user ${userId} is outside JavaScript's safe range.`);
  }

  return parsed;
}

/**
 * Downloads the public MEE6 leaderboard page-by-page. Only Discord IDs and raw
 * cumulative XP leave this function; usernames and avatars are discarded.
 */
export async function fetchMee6Leaderboard(
  options: Mee6FetchOptions,
): Promise<Mee6FetchResult> {
  if (!DISCORD_ID.test(options.guildId)) {
    throw new RangeError("MEE6 guild ID must be a 17-20 digit Discord server ID.");
  }

  const pageSize = options.pageSize ?? 1_000;

  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new RangeError("MEE6 page size must be between 1 and 1,000.");
  }

  const pageDelayMilliseconds = options.pageDelayMilliseconds ?? 750;

  if (
    !Number.isSafeInteger(pageDelayMilliseconds) ||
    pageDelayMilliseconds < 0 ||
    pageDelayMilliseconds > 60_000
  ) {
    throw new RangeError("MEE6 page delay must be between 0 and 60,000 ms.");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const retryDelay = options.retryDelay ?? delay;
  const rows: Mee6FetchedXpRow[] = [];
  const seenUserIds = new Set<string>();
  let guildName = "";
  let pagesFetched = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = requireRecord(
      await requestPage(fetchImpl, options.guildId, page, pageSize, retryDelay),
      `MEE6 page ${page}`,
    );
    const guild = requireRecord(payload.guild, `MEE6 page ${page} guild`);

    if (guild.id !== options.guildId) {
      throw new Error(
        `MEE6 returned guild ${String(guild.id)} while ${options.guildId} was requested.`,
      );
    }

    if (typeof guild.name !== "string" || guild.name.trim().length === 0) {
      throw new Error(`MEE6 page ${page} is missing the guild name.`);
    }

    if (guildName && guildName !== guild.name) {
      throw new Error("MEE6 changed the guild name between leaderboard pages.");
    }

    guildName = guild.name;

    if (!Array.isArray(payload.players)) {
      throw new Error(`MEE6 page ${page} is missing its players array.`);
    }

    for (const rawPlayer of payload.players) {
      const player = requireRecord(rawPlayer, `MEE6 page ${page} player`);
      const userId = player.id;

      if (typeof userId !== "string" || !DISCORD_ID.test(userId)) {
        throw new Error(`MEE6 page ${page} contains an invalid Discord user ID.`);
      }

      if (seenUserIds.has(userId)) {
        throw new Error(
          `MEE6 returned duplicate user ${userId} across leaderboard pages. Fetch again after the leaderboard settles.`,
        );
      }

      seenUserIds.add(userId);
      rows.push({ userId, rawXp: parseRawXp(player.xp, page, userId) });
    }

    pagesFetched += 1;
    options.onPageFetched?.(page, payload.players.length);

    if (rows.length > MAX_ROWS) {
      throw new Error(`MEE6 returned more than ${MAX_ROWS.toLocaleString("en-US")} rows.`);
    }

    if (payload.players.length < pageSize) {
      if (rows.length === 0) {
        throw new Error("The public MEE6 leaderboard contains no ranked users.");
      }

      return { guildId: options.guildId, guildName, rows, pagesFetched };
    }

    if (pageDelayMilliseconds > 0) {
      await retryDelay(pageDelayMilliseconds);
    }
  }

  throw new Error(
    `MEE6 pagination exceeded ${MAX_PAGES} pages; no file was created.`,
  );
}

export function buildMee6ImportCsv(rows: readonly Mee6FetchedXpRow[]): string {
  return `user_id,xp\n${rows.map((row) => `${row.userId},${row.rawXp}`).join("\n")}\n`;
}
