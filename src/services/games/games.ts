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
    answers: [
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "pink",
      "brown",
      "black",
      "white",
      "grey",
      "gray",
      "cyan",
      "magenta",
      "violet",
      "indigo",
      "teal",
      "turquoise",
      "gold",
      "silver",
      "maroon",
      "navy",
      "beige",
    ],
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
    answers: [
      "cat",
      "dog",
      "horse",
      "cow",
      "sheep",
      "goat",
      "pig",
      "chicken",
      "duck",
      "rabbit",
      "mouse",
      "rat",
      "lion",
      "tiger",
      "elephant",
      "giraffe",
      "zebra",
      "bear",
      "wolf",
      "fox",
      "deer",
      "monkey",
      "gorilla",
      "panda",
      "koala",
      "kangaroo",
      "dolphin",
      "whale",
      "shark",
      "octopus",
      "penguin",
      "eagle",
      "owl",
      "snake",
      "turtle",
      "crocodile",
      "frog",
      "bee",
      "butterfly",
      "spider",
    ],
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
    answers: [
      "germany",
      "france",
      "italy",
      "spain",
      "portugal",
      "netherlands",
      "belgium",
      "switzerland",
      "austria",
      "poland",
      "sweden",
      "norway",
      "finland",
      "denmark",
      "ireland",
      "united kingdom",
      "greece",
      "ukraine",
      "romania",
      "czechia",
      "canada",
      "united states",
      "mexico",
      "brazil",
      "argentina",
      "chile",
      "peru",
      "japan",
      "china",
      "india",
      "south korea",
      "indonesia",
      "thailand",
      "vietnam",
      "australia",
      "new zealand",
      "egypt",
      "morocco",
      "nigeria",
      "kenya",
      "south africa",
      "turkey",
    ],
  },
  {
    name: "Sports",
    answers: [
      "football",
      "basketball",
      "baseball",
      "volleyball",
      "tennis",
      "badminton",
      "cricket",
      "rugby",
      "golf",
      "hockey",
      "swimming",
      "cycling",
      "running",
      "boxing",
      "wrestling",
      "judo",
      "karate",
      "taekwondo",
      "fencing",
      "archery",
      "gymnastics",
      "skiing",
      "snowboarding",
      "surfing",
      "skateboarding",
      "rowing",
      "sailing",
      "handball",
      "table tennis",
      "water polo",
    ],
  },
  {
    name: "Musical instruments",
    answers: [
      "piano",
      "guitar",
      "violin",
      "viola",
      "cello",
      "flute",
      "clarinet",
      "oboe",
      "bassoon",
      "trumpet",
      "trombone",
      "tuba",
      "saxophone",
      "harp",
      "ukulele",
      "banjo",
      "mandolin",
      "accordion",
      "harmonica",
      "drums",
      "xylophone",
      "marimba",
      "triangle",
      "tambourine",
      "recorder",
      "bagpipes",
      "organ",
      "sitar",
    ],
  },
  {
    name: "Minecraft mobs",
    answers: [
      "zombie",
      "skeleton",
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
    answers: [
      "teacher",
      "doctor",
      "nurse",
      "dentist",
      "vet",
      "engineer",
      "architect",
      "programmer",
      "electrician",
      "plumber",
      "carpenter",
      "mechanic",
      "chef",
      "baker",
      "farmer",
      "scientist",
      "pilot",
      "astronaut",
      "firefighter",
      "paramedic",
      "police officer",
      "lawyer",
      "judge",
      "accountant",
      "journalist",
      "photographer",
      "artist",
      "musician",
      "actor",
      "author",
      "librarian",
      "translator",
      "barber",
      "hairdresser",
      "tailor",
      "florist",
      "waiter",
      "cleaner",
      "driver",
      "soldier",
    ],
  },
] as const;
interface Session {
  game: GameName;
  starter: string;
  score: number;
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
  reaction?: "⬆️" | "⬇️" | "✅";
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
  start(
    channel: string,
    game: GameName,
    starter: string,
    now = Date.now(),
  ): string {
    const active = this.sessions.get(channel);
    if (active)
      return `This channel is already playing ${active.game}. Stop it with /game ${active.game} stop first.`;
    const category =
      categories[Math.floor(this.random() * categories.length)] ??
      categories[0];
    this.sessions.set(channel, {
      game,
      starter,
      score: 0,
      lastUser: undefined,
      word: "apple",
      used: new Set(game === "wordchain" ? ["apple"] : []),
      category,
      target: game === "higherlower" ? Math.floor(this.random() * 10_000) + 1 : 0,
      guesses: 0,
      expiresAt: now + (game === "categories" ? 30_000 : 30 * 60_000),
    });
    return game === "higherlower"
      ? "Higher/lower started! Guess the secret whole number from **1 to 10,000**. Anyone can guess, including consecutive turns. I react ⬆️ if the secret number is higher and ⬇️ if it is lower. A correct guess ends the round. Ends after 30 minutes without a valid guess."
      : game === "wordchain"
      ? "Word chain started! First word: **apple**. Send one English word starting with **e**. No repeats or consecutive turns. Build a shared chain! Ends after 30 minutes without a valid turn."
      : game === "counting"
        ? "Counting started! Send **1**. Take turns counting upward; replace every multiple of 5 with **yap**. I confirm valid turns with ✅ reactions. A wrong number or consecutive turn resets the streak. Ordinary chat is ignored. Ends after 30 minutes without a valid turn."
        : `Category rush! **${category.name}** — find as many different answers together as possible in **30 seconds**. One answer per message; repeats do not add points. ${
            category.name === "Minecraft blocks"
              ? `All **${minecraftBlockCount.toLocaleString("en-US")} blocks** from **Minecraft Java ${minecraftVersion}**. Type **Blue Ice** or **Ice** as separate messages — both count as different answers. **Smooth Stone** works too. Spaces or underscores are accepted, and capitalization does not matter. Blue Ice and blue_ice are the same answer.`
              : `Example: **${category.answers[0]}**. Multi-word answers go in one message; capitalization does not matter. Uses a curated English answer list.`
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
    return `${game} stopped. Shared score: **${s.score}**.`;
  }
  expire(channel: string, now = Date.now()): GameResult | undefined {
    const s = this.sessions.get(channel);
    if (!s || now < s.expiresAt) return;
    this.sessions.delete(channel);
    return {
      text: s.game === "higherlower"
        ? "Higher/lower expired after 30 minutes without a valid guess. Start another with /game higherlower start."
        : `${s.game} finished! Shared score: **${s.score}**. Start another with /game ${s.game} start.`,
      game: s.game,
      score: s.score,
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
    let text: string;
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
        const repeated = user === s.lastUser;
        s.score = 0;
        s.lastUser = undefined;
        return {
          text: `Oops! ${repeated ? "Take turns." : `Expected **${expected}** (different players must take turns).`} Streak ended at **${score}**. Start again at **1**.`,
          game: s.game,
          score,
        };
      }
      s.score++;
      s.lastUser = user;
      s.expiresAt = now + 30 * 60_000;
      return { text: "", reaction: "✅", game: s.game, score: s.score };
    } else if (s.game === "wordchain") {
      if (!/^[a-z]{2,40}$/.test(answer)) return;
      if (!this.words.has(answer))
        return {
          text: "That word is not in the English dictionary. The chain is unchanged.",
          game: s.game,
          score: s.score,
        };
      if (s.used.has(answer))
        return {
          text: "That word has already been used. Try another!",
          game: s.game,
          score: s.score,
        };
      if (s.lastUser === user)
        return {
          text: "Let another player take the next turn!",
          game: s.game,
          score: s.score,
        };
      if (!answer.startsWith(s.word.slice(-1)))
        return {
          text: `The next word must start with **${s.word.slice(-1)}**.`,
          game: s.game,
          score: s.score,
        };
      s.word = answer;
      s.used.add(answer);
      s.score++;
      text = `✅ Chain: **${s.score}**. Next letter: **${answer.slice(-1)}**.`;
    } else {
      const minecraft = s.category.name === "Minecraft blocks";
      if (!minecraft && !(s.category.answers as readonly string[]).includes(answer)) return;
      // Block aliases share a registry identity; grey/gray share a colour identity.
      const key = minecraft ? minecraftBlockKey(answer) : answer === "gray" ? "grey" : answer;
      if (!key || s.used.has(key)) return;
      s.used.add(key);
      s.score++;
      text = `✅ **${s.score}** different answers together!`;
    }
    s.lastUser = user;
    if (s.game !== "categories") s.expiresAt = now + 30 * 60_000;
    return { text, game: s.game, score: s.score };
  }
}
