import type { Message, MessageCreateOptions } from "discord.js";
import type { Player } from "lavalink-client";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../utils/types.js";

/** Send a message to the text channel the player was started from. Never throws; returns the message or null. */
export async function sendToPlayerChannel(
  client: BotClient,
  player: Player,
  message: MessageCreateOptions,
): Promise<Message | null> {
  if (!player.textChannelId) return null;
  try {
    const channel = client.channels.cache.get(player.textChannelId) ?? (await client.channels.fetch(player.textChannelId));
    if (channel?.isSendable()) return await channel.send(message);
  } catch (error) {
    logger.warn({ err: error, guildId: player.guildId }, "Could not send message to player text channel");
  }
  return null;
}
