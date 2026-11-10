import { AttachmentBuilder, EmbedBuilder, MessageFlags, type InteractionReplyOptions } from "discord.js";
import { categories } from "../services/games/games.js";
import { yapperColors } from "../presentation/colors.js";

export function buildCategoryAnswersResponse(name: string): InteractionReplyOptions {
  const category = categories.find(category => category.name.toLowerCase() === name.trim().toLowerCase());
  if (!category) return { content: "Choose a category from `/game categories list category:`.", flags: MessageFlags.Ephemeral };
  const answers = [...category.answers].sort((a, b) => a.localeCompare(b));
  const list = answers.map(answer => `\`${answer}\``).join(" · ");
  const heading = `**${answers.length.toLocaleString("en-US")} accepted answers**`;
  const description = `${heading}\n\n${list}`;
  const attached = description.length > 4096;
  const embed = new EmbedBuilder()
    .setColor(yapperColors.violet)
    .setTitle(`📚 ${category.name}`)
    .setDescription(attached ? `${heading}\n\nThe complete alphabetical list is attached below.` : description)
    .setFooter({ text: "One answer per message · Names with spaces work · Capitalization does not matter" });
  if (category.name === "Minecraft blocks")
    embed.addFields({ name: "Also accepted", value: "Block IDs and `minecraft:` IDs work too. `Blue Ice`, `blue_ice` and `minecraft:blue_ice` count as the same answer." });
  if (category.name === "Colours")
    embed.addFields({ name: "Same answer", value: "`grey` and `gray` count as one answer." });
  return {
    embeds: [embed],
    ...(attached ? { files: [new AttachmentBuilder(
      Buffer.from(`${category.name} — accepted answers (${answers.length})\n\n${answers.join("\n")}\n`, "utf8"),
      { name: `${category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-accepted-answers.txt` },
    )] } : {}),
    allowedMentions: { parse: [] },
  };
}
