import type { Pool } from "pg";

export interface HigherLowerLeaderboard {
  totalWins: number;
  legacyWins: number;
  channels: { channelId: string; wins: number }[];
}

export class HigherLowerWins {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async record(guildId: string, channelId: string, messageId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO higherlower_wins (guild_id, channel_id, message_id) VALUES ($1, $2, $3)
       ON CONFLICT (message_id) DO NOTHING`,
      [guildId, channelId, messageId],
    );
  }

  async leaderboard(guildId: string): Promise<HigherLowerLeaderboard> {
    const result = await this.pool.query<HigherLowerLeaderboard>(
      `WITH legacy AS (
         SELECT COALESCE(SUM(wins), 0)::int AS wins FROM higherlower_legacy_wins WHERE guild_id = $1
       ), current AS (
         SELECT channel_id, COUNT(*)::int AS wins FROM higherlower_wins WHERE guild_id = $1 GROUP BY channel_id
       ), ranked AS (
         SELECT channel_id, wins FROM current ORDER BY wins DESC, channel_id ASC LIMIT 10
       )
       SELECT (legacy.wins + COALESCE((SELECT SUM(wins) FROM current), 0))::int AS "totalWins",
         legacy.wins AS "legacyWins",
         COALESCE((SELECT json_agg(json_build_object('channelId', channel_id, 'wins', wins)
           ORDER BY wins DESC, channel_id ASC) FROM ranked), '[]'::json) AS channels
       FROM legacy`,
      [guildId],
    );
    return result.rows[0] ?? { totalWins: 0, legacyWins: 0, channels: [] };
  }
}

export function formatHigherLowerLeaderboard(board: HigherLowerLeaderboard): string {
  return [
    "**Higher/lower wins leaderboard**",
    `🏆 Total completed games: **${board.totalWins.toLocaleString("en-US")}**`,
    `Historical wins from the previous bot: **${board.legacyWins.toLocaleString("en-US")}** (shared total; channel attribution unavailable).`,
    "",
    "**Channel wins tracked by Yapper**",
    ...board.channels.map((entry, index) => `${index + 1}. <#${entry.channelId}> — **${entry.wins.toLocaleString("en-US")}** wins`),
    ...(board.channels.length ? [] : ["No new completed games yet. Solve a round to add a win!"]),
  ].join("\n");
}
