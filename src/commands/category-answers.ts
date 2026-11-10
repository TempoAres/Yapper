import { AttachmentBuilder, EmbedBuilder, MessageFlags, type InteractionReplyOptions } from "discord.js";
import { countryAliases } from "../services/games/country-data.js";
import { categories } from "../services/games/games.js";
import { yapperColors } from "../presentation/colors.js";

export function buildCategoryAnswersResponse(name: string): InteractionReplyOptions {
  const category = categories.find(category => category.name.toLowerCase() === name.trim().toLowerCase());
  if (!category) return { content: "Choose a category from `/game categories list category:`.", flags: MessageFlags.Ephemeral };
  const answers = [...category.answers].sort((a, b) => a.localeCompare(b));
  const list = answers.map(answer => `\`${answer}\``).join(" · ");
  const heading = `**${answers.length.toLocaleString("en-US")} accepted answers**`;
  const description = `${heading}\n\n${list}`;
  const countryList = category.name === "Countries";
  const attached = description.length > 4096 || countryList;
  const source = countryList
    ? " — Country data: mledoze/countries contributors; ODbL 1.0; source https://github.com/mledoze/countries/tree/fa4f62182d19ff4f8b325cde6387c9cd9d80955a; license https://opendatacommons.org/licenses/odbl/1-0/"
    : "";
  const listedAnswers = countryList ? answers.map(answer => {
    const aliases = Object.entries(countryAliases).filter(([, canonical]) => canonical === answer).map(([alias]) => alias);
    return answer + (aliases.length ? ` — also: ${aliases.join("; ")}` : "");
  }) : answers;
  const embed = new EmbedBuilder()
    .setColor(yapperColors.violet)
    .setTitle(`📚 ${category.name}`)
    .setDescription(attached ? `${heading}\n\nThe complete alphabetical list is attached below.` : description)
    .setFooter({ text: "One answer per message · Names with spaces work · Capitalization does not matter" });
  if (category.name === "Minecraft blocks")
    embed.addFields({ name: "Also accepted", value: "Block IDs and `minecraft:` IDs work too. `Blue Ice`, `blue_ice` and `minecraft:blue_ice` count as the same answer." });
  if (category.name === "Colours")
    embed.addFields({ name: "Same answer", value: "`grey`/`gray` spellings work for every shade, including `light grey`/`light gray`. Each shade counts once." });
  if (category.name === "Countries")
    embed.addFields({ name: "Country names", value: "Includes countries and territories, plus the four UK constituent countries. Common and official names work; aliases such as `USA`, `UK`, `UAE`, `Czech Republic` and `Côte d'Ivoire` count as their matching country." });
  if (countryList)
    embed.addFields({ name: "Country data", value: "[mledoze/countries contributors](https://github.com/mledoze/countries) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The attached list includes every accepted country name and alias." });
  return {
    embeds: [embed],
    ...(attached ? { files: [new AttachmentBuilder(
      Buffer.from(`${category.name} — accepted answers (${answers.length})${source}\n\n${listedAnswers.join("\n")}\n`, "utf8"),
      { name: `${category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-accepted-answers.txt` },
    )] } : {}),
    allowedMentions: { parse: [] },
  };
}
