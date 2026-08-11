import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type Guild,
  type InteractionEditReplyOptions,
} from "discord.js";

import type { BotCommand } from "./command.js";
import { yapperColors } from "../presentation/colors.js";
import type {
  RoleRewardService,
  XpRoleReward,
} from "../services/roles/role-reward-service.js";

const REWARDS_PER_EMBED = 20;
const MAX_REWARD_EMBEDS = 10;

function chunkRewards(
  rewards: readonly XpRoleReward[],
): readonly (readonly XpRoleReward[])[] {
  const chunks: XpRoleReward[][] = [];
  const visibleRewards = rewards.slice(
    0,
    REWARDS_PER_EMBED * MAX_REWARD_EMBEDS,
  );

  for (let index = 0; index < visibleRewards.length; index += REWARDS_PER_EMBED) {
    chunks.push(visibleRewards.slice(index, index + REWARDS_PER_EMBED));
  }

  return chunks;
}

export async function buildRewardsResponse(
  guild: Guild,
  rewardService: RoleRewardService,
): Promise<InteractionEditReplyOptions> {
  const rewards = await rewardService.listRewards(guild.id);

  if (rewards.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(yapperColors.violet)
          .setTitle("Yapper level rewards")
          .setDescription("No level rewards are configured yet."),
      ],
    };
  }

  const roles = await guild.roles.fetch();
  const chunks = chunkRewards(rewards);
  const embeds = chunks.map((chunk, pageIndex) => {
    const lines = chunk.map((reward) => {
      const role = roles.get(reward.roleId);
      const roleLabel = role
        ? `<@&${role.id}>`
        : `Deleted role \`${reward.roleId}\``;
      return `**${reward.requiredLevel}.** ${roleLabel} \`[lvl${reward.requiredLevel}]\``;
    });

    return new EmbedBuilder()
      .setColor(yapperColors.violet)
      .setTitle(
        chunks.length === 1
          ? "Rewards"
          : `Rewards \u2022 ${pageIndex + 1}/${chunks.length}`,
      )
      .setDescription(lines.join("\n"))
      .setFooter({
        text:
          rewards.length > REWARDS_PER_EMBED * MAX_REWARD_EMBEDS
            ? `Rewards stack \u2022 Showing the first ${REWARDS_PER_EMBED * MAX_REWARD_EMBEDS} of ${rewards.length}`
            : "Rewards stack as members reach higher levels",
      });
  });

  return {
    embeds,
    allowedMentions: { parse: [] },
  };
}

export const rewardsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rewards")
    .setDescription("List every Yapper level reward without pinging its role."),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Level rewards can only be viewed inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    await interaction.editReply(
      await buildRewardsResponse(interaction.guild, context.roleRewardService),
    );
  },
};
