import { expandedCategoryAnswers, categoryAnswerKey } from "./category-data.js";
import {
  minecraftBlockAnswers,
  minecraftBlockKey,
  minecraftBlockCount,
  minecraftVersion,
} from "./minecraft-blocks.js";

export const gameNames = [
  "wordchain",
  "categories",
  "counting",
  "higherlower",
] as const;
export type GameName = (typeof gameNames)[number];
export const categories = [
  {
    name: "Colours",
    answers: expandedCategoryAnswers["Colours"]!,
  },
  {
    name: "Planets in our solar system",
    answers: [
      "mercury",
      "venus",
      "earth",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
    ],
  },
  {
    name: "Days and months",
    answers: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ],
  },
  {
    name: "Animals",
    answers: expandedCategoryAnswers["Animals"]!,
  },
  {
    name: "Fruits",
    answers: [
      "apple",
      "banana",
      "orange",
      "pear",
      "peach",
      "plum",
      "cherry",
      "strawberry",
      "raspberry",
      "blueberry",
      "blackberry",
      "grape",
      "watermelon",
      "melon",
      "pineapple",
      "mango",
      "papaya",
      "kiwi",
      "lemon",
      "lime",
      "grapefruit",
      "apricot",
      "nectarine",
      "pomegranate",
      "coconut",
      "fig",
      "date",
      "guava",
      "passion fruit",
      "dragon fruit",
    ],
  },
  {
    name: "Vegetables",
    answers: [
      "carrot",
      "potato",
      "onion",
      "garlic",
      "broccoli",
      "cauliflower",
      "spinach",
      "lettuce",
      "cabbage",
      "kale",
      "celery",
      "cucumber",
      "courgette",
      "aubergine",
      "pepper",
      "pumpkin",
      "sweet potato",
      "beetroot",
      "radish",
      "turnip",
      "parsnip",
      "leek",
      "pea",
      "asparagus",
      "artichoke",
      "brussels sprout",
    ],
  },
  {
    name: "Countries",
    answers: expandedCategoryAnswers["Countries"]!,
  },
  {
    name: "Sports",
    answers: expandedCategoryAnswers["Sports"]!,
  },
  {
    name: "Musical instruments",
    answers: expandedCategoryAnswers["Musical instruments"]!,
  },
  {
    name: "Minecraft mobs",
    answers: [
      "zombie",
      "skeleton",
      "wither skeleton",
      "creeper",
      "spider",
      "enderman",
      "witch",
      "slime",
      "ghast",
      "blaze",
      "magma cube",
      "wither",
      "ender dragon",
      "warden",
      "pillager",
      "vindicator",
      "evoker",
      "ravager",
      "phantom",
      "drowned",
      "husk",
      "stray",
      "bogged",
      "breeze",
      "piglin",
      "piglin brute",
      "zoglin",
      "hoglin",
      "strider",
      "shulker",
      "silverfish",
      "endermite",
      "guardian",
      "elder guardian",
      "cow",
      "pig",
      "sheep",
      "chicken",
      "horse",
      "donkey",
      "mule",
      "cat",
      "wolf",
      "fox",
      "rabbit",
      "bee",
      "bat",
      "frog",
      "tadpole",
      "axolotl",
      "squid",
      "glow squid",
      "dolphin",
      "turtle",
      "sniffer",
      "allay",
      "armadillo",
      "camel",
      "villager",
      "wandering trader",
      "iron golem",
      "snow golem",
      "polar bear",
      "panda",
      "goat",
      "llama",
      "ocelot",
      "parrot",
      "cod",
      "salmon",
      "pufferfish",
      "tropical fish",
    ],
  },
  {
    name: "Minecraft blocks",
    answers: minecraftBlockAnswers,
  },
  {
    name: "Jobs and professions",
    answers: expandedCategoryAnswers["Jobs and professions"]!,
  },
] as const;
interface Session {
  game: GameName;
  starter: string;
  score: number;
  peakScore: number;
  lastUser: string | undefined;
  word: string;
  used: Set<string>;
  category: (typeof categories)[number];
  target: number;
  guesses: number;
  expiresAt: number;
}
export interface GameResult {
  text: string;
  completed?: boolean;
  reaction?: "⬆️" | "⬇️" | "✅" | "❌" | "🔁" | "⏳";
  game: GameName;
  score: number;
}
export class Games {
  private readonly records = new Map<string, number>();
  best(channel: string, game: GameName): number {
    return this.records.get(`${channel}:${game}`) ?? 0;
  }
  remember(channel: string, game: GameName, score: number): void {
    this.records.set(
      `${channel}:${game}`,
      Math.max(score, this.best(channel, game)),
    );
  }
  private readonly sessions = new Map<string, Session>();
  private categoryCycles?: Map<string, { remaining: number[]; last: number | undefined }>;
  private pickCategory(channel: string, requested?: string): (typeof categories)[number] | undefined {
    const selected = requested === undefined
      ? undefined
      : categories.findIndex(category => category.name.toLowerCase() === requested.trim().toLowerCase());
    if (selected === -1) return undefined;
    const cycles = this.categoryCycles ??= new Map();
    let cycle = cycles.get(channel);
    if (!cycle || cycle.remaining.length === 0) {
      cycle = { remaining: categories.map((_, index) => index), last: cycle?.last };
      cycles.set(channel, cycle);
    }
    const different = cycle.remaining.filter(index => index !== cycle.last);
    const candidates = different.length ? different : cycle.remaining;
    const index = selected ?? candidates[Math.floor(this.random() * candidates.length)] ?? candidates[0]!;
    cycle.remaining = cycle.remaining.filter(remaining => remaining !== index);
    cycle.last = index;
    return categories[index];
  }
  constructor(
    private readonly words: ReadonlySet<string>,
    private readonly random = Math.random,
  ) {}
  sessionToken(channel: string): object | undefined {
    return this.sessions.get(channel);
  }
  active(channel: string): GameName | undefined {
    return this.sessions.get(channel)?.game;
  }
  wordchainScore(channel: string, now = Date.now()): number | undefined {
    const session = this.sessions.get(channel);
    if (session?.game === "wordchain" && now < session.expiresAt)
      return session.score;
    return undefined;
  }
  start(
    channel: string,
    game: GameName,
    starter: string,
    now = Date.now(),
    categoryName?: string,
  ): string {
    const active = this.sessions.get(channel);
    if (active)
      return `This channel is already playing ${active.game}. Stop it with /game ${active.game} stop first.`;
    const category = game === "categories" ? this.pickCategory(channel, categoryName) : categories[0];
    if (!category) return "Unknown category. Choose one from `/game categories start category:`.";
    this.sessions.set(channel, {
      game,
      starter,
      score: 0,
      peakScore: 0,
      lastUser: undefined,
      word: "apple",
      used: new Set(game === "wordchain" ? ["apple"] : []),
      category,
      target: game === "higherlower" ? Math.floor(this.random() * 10_000) + 1 : 0,
      guesses: 0,
      expiresAt: now + (game === "categories" ? 60_000 : 30 * 60_000),
    });
    return game === "higherlower"
      ? "Higher/lower started! Guess the secret whole number from **1 to 10,000**. Anyone can guess, including consecutive turns. I react ⬆️ if the secret number is higher and ⬇️ if it is lower. A correct guess ends the round. Ends after 30 minutes without a valid guess."
      : game === "wordchain"
      ? "Word chain started! First word: **apple**. Send one English word starting with **e**. No repeats or consecutive turns. ✅ accepted, ❌ invalid, 🔁 already used, ⏳ wait for another player. The next letter is the last letter of the accepted word. Build a shared chain! Ends after 30 minutes without a valid turn."
      : game === "counting"
        ? "Counting started! Send **1**. Take turns counting upward; replace every multiple of 5 with **yap**. ✅ means a valid turn; ❌ means a wrong number or consecutive turn and resets the streak; start again at **1**. Ordinary chat is ignored. Ends after 30 minutes without a valid turn."
        : `Category rush! **${category.name}** — find as many different answers together as possible in **60 seconds**. One answer per message. ✅ accepted, 🔁 already counted; repeats do not add points. ${
            category.name === "Minecraft blocks"
              ? `All **${minecraftBlockCount.toLocaleString("en-US")} blocks** from **Minecraft Java ${minecraftVersion}**. Type **Blue Ice** or **Ice** as separate messages — both count as different answers. **Smooth Stone** works too. Spaces or underscores are accepted, and capitalization does not matter. Blue Ice and blue_ice are the same answer.`
              : `Example: **${category.name === "Minecraft mobs" ? "Wither skeleton" : category.answers.find((answer) => answer.includes(" ")) ?? category.answers[0]}**. Multi-word answers go in one message; spaces or underscores are accepted, and capitalization does not matter. Uses a curated English answer list.`
          }`;
  }
  stop(
    channel: string,
    game: GameName,
  ): string {
    const s = this.sessions.get(channel);
    if (!s || s.game !== game) return `${game} is not running in this channel.`;
    this.sessions.delete(channel);
    if (game === "higherlower") return "higherlower stopped.";
    return game === "counting"
      ? `counting stopped. Best streak: **${s.peakScore}**.`
      : `${game} stopped. Shared score: **${s.score}**.`;
  }
  expire(channel: string, now = Date.now()): GameResult | undefined {
    const s = this.sessions.get(channel);
    if (!s || now < s.expiresAt) return;
    this.sessions.delete(channel);
    return {
      text: s.game === "higherlower"
        ? "Higher/lower expired after 30 minutes without a valid guess. Start another with /game higherlower start."
        : `${s.game} finished! ${s.game === "counting" ? `Best streak: **${s.peakScore}**` : `Shared score: **${s.score}**`}. Start another with /game ${s.game} start.`,
      game: s.game,
      score: s.game === "counting" ? s.peakScore : s.score,
    };
  }
  channels(): string[] {
    return [...this.sessions.keys()];
  }
  message(
    channel: string,
    user: string,
    content: string,
    now = Date.now(),
  ): GameResult | undefined {
    const expired = this.expire(channel, now);
    if (expired) return expired;
    const s = this.sessions.get(channel);
    if (!s) return;
    const answer = content.trim().toLowerCase();
    const feedback = (reaction: NonNullable<GameResult["reaction"]>): GameResult => ({
      text: "", reaction, game: s.game, score: s.score,
    });
    if (s.game === "higherlower") {
      if (!/^\d{1,5}$/.test(answer)) return;
      const guess = Number(answer);
      if (guess < 1 || guess > 10_000) return;
      s.guesses++;
      s.expiresAt = now + 30 * 60_000;
      if (guess !== s.target)
        return {
          text: "",
          reaction: guess < s.target ? "⬆️" : "⬇️",
          game: s.game,
          score: 0,
        };
      this.sessions.delete(channel);
      return {
        text: `🎉 Correct! The number was **${s.target}**. Solved together in **${s.guesses}** ${s.guesses === 1 ? "guess" : "guesses"}! Start another with /game higherlower start.`,
        completed: true,
        reaction: "✅",
        game: s.game,
        score: 0,
      };
    } else if (s.game === "counting") {
      if (!/^\d+$/.test(answer) && answer !== "yap") return;
      const next = s.score + 1;
      const expected = next % 5 === 0 ? "yap" : String(next);
      if (answer !== expected || user === s.lastUser) {
        const score = s.score;
        s.score = 0;
        s.lastUser = undefined;
        return {
          text: "",
          reaction: "❌",
          game: s.game,
          score,
        };
      }
      s.score++;
      s.peakScore = Math.max(s.peakScore, s.score);
      s.lastUser = user;
      s.expiresAt = now + 30 * 60_000;
      return { text: "", reaction: "✅", game: s.game, score: s.score };
    } else if (s.game === "wordchain") {
      if (!/^[a-z]{2,40}$/.test(answer)) return;
      if (!this.words.has(answer)) return feedback("❌");
      if (s.used.has(answer)) return feedback("🔁");
      if (s.lastUser === user) return feedback("⏳");
      if (!answer.startsWith(s.word.slice(-1))) return feedback("❌");
      s.word = answer;
      s.used.add(answer);
      s.score++;
    } else {
      const minecraft = s.category.name === "Minecraft blocks";
      const key = minecraft ? minecraftBlockKey(answer) : categoryAnswerKey(s.category.name, answer);
      // Look up expanded data by name so active rounds also accept the additions.
      const accepted = expandedCategoryAnswers[s.category.name] ?? s.category.answers;
      if (!key || (!minecraft && !accepted.includes(key))) return;
      if (s.used.has(key)) return feedback("🔁");
      s.used.add(key);
      s.score++;
    }
    s.lastUser = user;
    if (s.game !== "categories") s.expiresAt = now + 30 * 60_000;
    const result = feedback("✅");
    if (s.game === "wordchain" && s.score % 100 === 0)
      result.text = `🎉 Word-chain milestone: **${s.score}** words together! Next letter: **${s.word.slice(-1)}**.`;
    return result;
  }
}
