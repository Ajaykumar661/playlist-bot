import type { Player } from "lavalink-client";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { infoEmbed } from "../utils/embeds.js";
import { sendToPlayerChannel } from "./notify.js";
import type { BotClient } from "../utils/types.js";

export type IdleReason = "queue-empty" | "channel-empty";

interface IdleTimer {
  timeout: NodeJS.Timeout;
  reason: IdleReason;
}

const timers = new Map<string, IdleTimer>();

/**
 * Leave after config.idleTimeoutMs (3 min) if nothing changes.
 * Calling it again with the same reason keeps the original deadline.
 */
export function startIdleTimer(client: BotClient, player: Player, reason: IdleReason): void {
  // /247 keeps the bot in the channel no matter what.
  if (player.get<boolean>("stay247")) return;
  const existing = timers.get(player.guildId);
  if (existing?.reason === reason) return;
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(() => {
    timers.delete(player.guildId);
    void leaveForInactivity(client, player.guildId, reason);
  }, config.idleTimeoutMs);
  timeout.unref();

  timers.set(player.guildId, { timeout, reason });
  logger.debug({ guildId: player.guildId, reason }, "Idle timer started");
}

export function cancelIdleTimer(guildId: string, reason?: IdleReason): void {
  const existing = timers.get(guildId);
  if (!existing) return;
  if (reason && existing.reason !== reason) return;
  clearTimeout(existing.timeout);
  timers.delete(guildId);
  logger.debug({ guildId, reason: existing.reason }, "Idle timer cancelled");
}

async function leaveForInactivity(client: BotClient, guildId: string, reason: IdleReason): Promise<void> {
  const player = client.lavalink.getPlayer(guildId);
  if (!player) return;

  // Recheck at the deadline in case state changed without an event.
  if (reason === "queue-empty" && (player.queue.current || player.queue.tracks.length > 0)) return;

  const minutes = Math.round(config.idleTimeoutMs / 60_000);
  const text =
    reason === "queue-empty"
      ? `👋 The queue has been empty for ${minutes} minutes, so I left the voice channel.`
      : `👋 Everyone left the voice channel, so I left too after ${minutes} minutes.`;

  await sendToPlayerChannel(client, player, { embeds: [infoEmbed(text)] });
  try {
    await player.destroy(`Idle:${reason}`);
  } catch (error) {
    logger.warn({ err: error, guildId }, "Failed to destroy idle player");
  }
}
