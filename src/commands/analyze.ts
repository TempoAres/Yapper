import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  escapeMarkdown,
} from "discord.js";
import type { BotCommand } from "./command.js";
import type { AnalysisHistory } from "../services/analyze/history.js";
import { yapperColors } from "../presentation/colors.js";

const runningGuilds = new Set<string>();

export function analysisCoverage(history: AnalysisHistory): string {
  const missing = history.messages.filter((message) => !message.context).length;
  return [
    `Window: <t:${Math.floor(history.startedAt.getTime() / 1_000)}:f> to <t:${Math.floor(history.endsAt.getTime() / 1_000)}:f> (last 30 days).`,
    `**${history.messages.length.toLocaleString("en-US")} messages**; ${history.scannedChannels} channels/threads scanned.`,
    `${history.skippedChannels} known channels unreadable; ${history.failedChannels} history scans incomplete; ${history.threadDiscoveryFailures} thread listings incomplete; ${missing} messages without context.`,
    "Only accessible, surviving messages are included; files and linked pages are not analyzed. Preceding messages are context guesses, not confirmed replies.",
  ].join("\n");
}

export const analyzeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("analyze")
    .setDescription("Review a server member's messaging style over the last 30 days.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) => option.setName("user")
      .setDescription("Current server member to analyze").setRequired(true)),
  async execute(interaction, context) {
    const guild = interaction.guild;
    const deny = async (content: string): Promise<void> => {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    };
    if (!guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await deny("This command is restricted to server administrators and must run in a server.");
      return;
    }
    const service = context.analysisService;
    if (!service) {
      await deny("Message analysis is not configured. Set the OPENAI_API_KEY secret and OPENAI_MODEL on the bot first.");
      return;
    }
    const destination = interaction.channel;
    const bot = guild.members.me;
    const sendPermission = destination?.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!destination?.isSendable() || destination.isDMBased() || !bot ||
        !destination.permissionsFor(bot)?.has([
          PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.EmbedLinks,
        ])) {
      await deny("I need View Channel, Send Messages (or Send Messages in Threads), and Embed Links here to post the report.");
      return;
    }
    if (runningGuilds.has(guild.id)) {
      await deny("An analysis is already running for this server. Please wait for it to finish.");
      return;
    }

    runningGuilds.add(guild.id);
    let acknowledged = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      acknowledged = true;
      const target = interaction.options.getUser("user", true);
      const member = await guild.members.fetch({ user: target.id, force: true }).catch(() => null);
      if (!member) {
        await interaction.editReply("Choose a user who is currently a member of this server.");
        return;
      }
      if (target.bot) {
        await interaction.editReply("Choose a human server member to review their messaging style.");
        return;
      }
      await interaction.editReply("Analyzing the last 30 days across readable server channels and threads. This can take several minutes; the report will appear here when ready.");
      const result = await service.analyze(guild, target.id);
      // Long scans can outlive Discord's interaction token. Deliver using the
      // bot's channel API, with membership/authorization checked again first.
      const [currentAdmin, currentTarget] = await Promise.all([
        guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null),
        guild.members.fetch({ user: target.id, force: true }).catch(() => null),
      ]);
      if (!currentAdmin?.permissions.has(PermissionFlagsBits.Administrator) || !currentTarget) {
        await interaction.editReply("Analysis cancelled: the requester must still be an administrator and the target must still be in this server.").catch(() => undefined);
        return;
      }

      const description = result.summary
        ? result.summary.length > 3_900 ? `${result.summary.slice(0, 3_850)}\n… (report shortened)` : result.summary
        : "No analyzable messages were found for this member in accessible history during this window. No OpenAI request was made.";
      await destination.send({
        content: analysisCoverage(result.history),
        embeds: [new EmbedBuilder()
          .setColor(yapperColors.violet)
          .setTitle(`Messaging overview: ${escapeMarkdown(member.displayName)}`.slice(0, 256))
          .setDescription(description)
          .setFooter({ text: "AI interpretation of messages, not a personality assessment. Bias and missing context are possible." })],
        allowedMentions: { parse: [] },
      });
      await interaction.editReply("Analysis posted in this channel.").catch(() => undefined);
    } catch {
      // Never log transcripts, API payloads, or provider error bodies.
      const content = "The analysis could not be completed or posted. Check the bot's channel permissions, OpenAI configuration, and connectivity, then try again.";
      if (acknowledged) {
        await interaction.editReply(content).catch(async () => {
          await destination.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
        });
      } else {
        await deny(content);
      }
    } finally {
      runningGuilds.delete(guild.id);
    }
  },
};
