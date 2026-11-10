import { HigherLowerWins } from "../services/games/higherlower-wins.js";
import { Events, type Client } from "discord.js";
import type { Pool } from "pg";
import {
  Games,
  type GameName,
  type GameResult,
} from "../services/games/games.js";

export async function registerGames(
  client: Client,
  games: Games,
  pool: Pool,
  wins = new HigherLowerWins(pool),
): Promise<void> {
  const rows = await pool.query<{
    channel_id: string;
    game: GameName;
    score: number;
  }>("SELECT channel_id, game, score FROM channel_game_records");
  for (const row of rows.rows)
    games.remember(row.channel_id, row.game, row.score);
  const pending = new Map<string, Promise<void>>();
  const enqueue = (channel: string, work: () => Promise<void>): void => {
    const job = (pending.get(channel) ?? Promise.resolve())
      .then(work)
      .catch((error) => console.error("Channel game failed:", error));
    pending.set(channel, job);
    void job.finally(() => {
      if (pending.get(channel) === job) pending.delete(channel);
    });
  };
  const record = async (
    channel: string,
    result: GameResult,
  ): Promise<string> => {
    if (result.score <= games.best(channel, result.game)) return result.text;
    await pool.query(
      `INSERT INTO channel_game_records (channel_id, game, score) VALUES ($1, $2, $3)
      ON CONFLICT (channel_id, game) DO UPDATE SET score = GREATEST(channel_game_records.score, EXCLUDED.score)`,
      [channel, result.game, result.score],
    );
    games.remember(channel, result.game, result.score);
    return `${result.text}\n🏆 New shared channel record: **${result.score}**!`;
  };
  client.on(Events.MessageCreate, (message) => {
    if (
      !message.inGuild() ||
      message.author.bot ||
      message.webhookId ||
      !games.active(message.channelId)
    )
      return;
    const receivedAt = Date.now();
    const session = games.sessionToken(message.channelId);
    enqueue(message.channelId, async () => {
      if (games.sessionToken(message.channelId) !== session) return;
      const result = games.message(
        message.channelId,
        message.author.id,
        message.content,
        receivedAt,
      );
      if (!result) return;
      if (result.completed && result.game === "higherlower") {
        await wins.record(message.guildId, message.channelId, message.id);
        const board = await wins.leaderboard(message.guildId);
        result.text += `\n🏆 Total completed games: **${board.totalWins.toLocaleString("en-US")}**. View /game higherlower leaderboard.`;
      }
      if (result.reaction) {
        try {
          await message.react(result.reaction);
        } catch (error) {
          console.error("Channel game reaction failed:", error);
        }
      }
      if (!result.text) return;
      const content = await record(message.channelId, result);
      await message.channel.send({ content, allowedMentions: { parse: [] } });
    });
  });
  const timer = setInterval(() => {
    for (const channelId of games.channels())
      enqueue(channelId, async () => {
        const result = games.expire(channelId);
        if (!result) return;
        const content = await record(channelId, result);
        const channel = await client.channels.fetch(channelId);
        if (channel?.isSendable())
          await channel.send({ content, allowedMentions: { parse: [] } });
      });
  }, 1000);
  timer.unref();
  const destroy = client.destroy.bind(client);
  client.destroy = () => {
    clearInterval(timer);
    return destroy();
  };
}
