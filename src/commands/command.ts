import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { MemberXpService } from "../services/xp/member-xp-service.js";

export interface CommandContext {
  memberXpService: MemberXpService;
}

export interface SlashCommandData {
  readonly name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface BotCommand {
  data: SlashCommandData;
  execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext,
  ): Promise<void>;
}
