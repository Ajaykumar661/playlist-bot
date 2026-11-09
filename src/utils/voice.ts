import { PermissionFlagsBits, type ChatInputCommandInteraction, type VoiceBasedChannel } from "discord.js";
import type { Player } from "lavalink-client";
import type { BotClient } from "./types.js";
import { replyError } from "./embeds.js";

interface VoiceCheckOptions {
  /** The command needs an existing player (everything except /play). */
  requirePlayer?: boolean;
  /** The command may create a player, so check Connect/Speak permissions. */
  willJoin?: boolean;
}

export interface VoiceContext {
  channel: VoiceBasedChannel;
  player: Player | undefined;
}

/**
 * Checks shared by all music commands:
 *  - the user is in a voice channel
 *  - if the bot is already connected elsewhere in this server, refuse politely
 *  - optionally: a player exists / the bot can join the channel
 * Replies with an error and returns null if a check fails.
 */
export async function checkVoice(
  interaction: ChatInputCommandInteraction<"cached">,
  client: BotClient,
  options: VoiceCheckOptions = {},
): Promise<VoiceContext | null> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await replyError(interaction, "You need to join a voice channel first.");
    return null;
  }

  const player = client.lavalink.getPlayer(interaction.guildId);
  const botChannelId = player?.voiceChannelId ?? interaction.guild.members.me?.voice.channelId ?? null;

  if (botChannelId && botChannelId !== channel.id) {
    await replyError(
      interaction,
      `Sorry, I'm already playing in <#${botChannelId}>. Join that channel, or wait until I'm done there.`,
    );
    return null;
  }

  if (options.requirePlayer && !player) {
    await replyError(interaction, "Nothing is playing right now. Use `/play` to start.");
    return null;
  }

  if (options.willJoin && !player) {
    const me = interaction.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      await replyError(interaction, `I don't have permission to join and speak in <#${channel.id}>.`);
      return null;
    }
    if (channel.full && !perms.has(PermissionFlagsBits.MoveMembers)) {
      await replyError(interaction, `<#${channel.id}> is full.`);
      return null;
    }
  }

  return { channel, player };
}
