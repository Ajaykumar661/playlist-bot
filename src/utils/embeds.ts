import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";

export const Colors = {
  primary: 0xfa243c, // Apple Music red
  success: 0x2ecc71,
  warning: 0xf1c40f,
  error: 0xe74c3c,
  info: 0x5865f2,
} as const;

export const errorEmbed = (message: string) => new EmbedBuilder().setColor(Colors.error).setDescription(`❌ ${message}`);
export const successEmbed = (message: string) => new EmbedBuilder().setColor(Colors.success).setDescription(`✅ ${message}`);
export const infoEmbed = (message: string) => new EmbedBuilder().setColor(Colors.info).setDescription(message);
export const warnEmbed = (message: string) => new EmbedBuilder().setColor(Colors.warning).setDescription(`⚠️ ${message}`);

/** Reply (or follow up / edit if already deferred) with an embed. */
export async function respond(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  ephemeral = false,
): Promise<void> {
  const payload: InteractionReplyOptions = { embeds: [embed] };
  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed] });
  } else if (interaction.replied) {
    await interaction.followUp({ ...payload, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
  } else {
    await interaction.reply({ ...payload, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
  }
}

export const replyError = (interaction: ChatInputCommandInteraction, message: string) =>
  respond(interaction, errorEmbed(message), true);

export const replySuccess = (interaction: ChatInputCommandInteraction, message: string) =>
  respond(interaction, successEmbed(message));
