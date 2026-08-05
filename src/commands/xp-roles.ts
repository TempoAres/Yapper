import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandGroupBuilder,
} from "discord.js";

import type { CommandContext } from "./command.js";
import type { RoleSyncResult } from "../services/roles/role-sync.js";

export type XpRolesSubcommand = "add" | "remove" | "list" | "sync";

export function buildRoleSubcommandGroup(
  group: SlashCommandSubcommandGroupBuilder,
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName("roles")
    .setDescription("Configure and synchronize stacked XP roles.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add one stackable role reward for a level.")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("The role Yapper should grant.")
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("level")
            .setDescription("The level required to earn this role.")
            .setMinValue(1)
            .setMaxValue(100_000)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove the configured reward at a level.")
        .addIntegerOption((option) =>
          option
            .setName("level")
            .setDescription("The configured level to remove.")
            .setMinValue(1)
            .setMaxValue(100_000)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List this server's configured XP role rewards."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("sync")
        .setDescription("Grant every earned configured role that is missing.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to synchronize; defaults to you."),
        ),
    );
}

function canManageRoles(interaction: ChatInputCommandInteraction): boolean {
  const permissions = interaction.memberPermissions;
  return Boolean(
    permissions?.has(PermissionFlagsBits.Administrator) ||
      permissions?.has(PermissionFlagsBits.ManageRoles),
  );
}

export function describeRoleSync(result: RoleSyncResult): string {
  if (result.configuredRoleCount === 0) {
    return `Member level: **${result.level}**\nNo XP role rewards are configured yet.`;
  }

  const lines = [
    `Member level: **${result.level}**`,
    `Earned configured roles: **${result.earnedRoleIds.length}**`,
    `Already present: **${result.existingRoleIds.length}**`,
    `Newly granted: **${result.addedRoleIds.length}**`,
  ];

  if (result.addedRoleIds.length > 0) {
    lines.push(`Granted: ${result.addedRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
  }

  if (result.issues.length > 0) {
    lines.push(
      "Issues:",
      ...result.issues.map((issue) => `- ${issue.message}`),
    );
  }

  return lines.join("\n");
}

export async function executeXpRolesCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  subcommand: XpRolesSubcommand,
): Promise<void> {
  const guild = interaction.guild;

  if (!guild) {
    await interaction.reply({
      content: "XP roles can only be managed inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManageRoles(interaction)) {
    await interaction.reply({
      content: "You need **Manage Roles** permission to configure XP roles.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "list") {
    const rewards = await context.roleRewardService.listRewards(guild.id);
    const lines = await Promise.all(
      rewards.map(async (reward) => {
        const role = await guild.roles.fetch(reward.roleId).catch(() => null);
        return role
          ? `Level **${reward.requiredLevel}** -> ${role}`
          : `Level **${reward.requiredLevel}** -> deleted role \`${reward.roleId}\``;
      }),
    );
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Stacked Yapper XP roles")
      .setDescription(
        lines.length > 0
          ? lines.join("\n")
          : "No XP role rewards are configured yet.",
      )
      .setFooter({
        text: "Members keep every earlier reward when earning higher levels",
      });
    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === "remove") {
    const level = interaction.options.getInteger("level", true);
    const removed = await context.roleRewardService.removeReward(guild.id, level);
    await interaction.editReply(
      removed
        ? `Removed the level **${level}** reward <@&${removed.roleId}>. Existing member roles were not revoked.`
        : `No XP role reward is configured at level **${level}**.`,
    );
    return;
  }

  if (subcommand === "add") {
    const roleOption = interaction.options.getRole("role", true);
    const role = await guild.roles.fetch(roleOption.id).catch(() => null);
    const level = interaction.options.getInteger("level", true);

    if (!role) {
      await interaction.editReply("That role no longer exists in this server.");
      return;
    }

    if (role.id === guild.id || role.managed) {
      await interaction.editReply(
        "Choose a normal server role. `@everyone` and Discord/integration-managed roles cannot be XP rewards.",
      );
      return;
    }

    const botMember = guild.members.me ?? (await guild.members.fetchMe());

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply(
        "Yapper needs **Manage Roles** permission before this reward can be configured.",
      );
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      await interaction.editReply(
        `${role} must be below Yapper's highest role in **Server Settings -> Roles**.`,
      );
      return;
    }

    const result = await context.roleRewardService.addReward({
      guildId: guild.id,
      roleId: role.id,
      requiredLevel: level,
    });

    if (result.status === "level_conflict") {
      await interaction.editReply(
        `Level **${level}** already grants <@&${result.reward.roleId}>. Remove that level first if you want to replace it.`,
      );
      return;
    }

    if (result.status === "role_conflict") {
      await interaction.editReply(
        `${role} is already configured for level **${result.reward.requiredLevel}**.`,
      );
      return;
    }

    await interaction.editReply(
      `Configured ${role} for level **${level}**. It stacks with every other earned XP role. Use \`/xp roles sync\` for immediate catch-up.`,
    );
    return;
  }

  const user = interaction.options.getUser("user") ?? interaction.user;

  if (user.bot) {
    await interaction.editReply("Bots do not receive Yapper XP roles.");
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    await interaction.editReply("That user is no longer a member of this server.");
    return;
  }

  const result = await context.roleRewardCoordinator.syncMember(member);
  await interaction.editReply({
    content: describeRoleSync(result),
    allowedMentions: { parse: [] },
  });
}
