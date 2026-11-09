import { Events } from "discord.js";
import { cancelIdleTimer, startIdleTimer } from "../music/idleManager.js";
import type { BotEvent } from "../utils/types.js";

/** Start the 3-minute leave timer when the bot's channel has no humans left, cancel it when someone returns. */
export const voiceStateUpdateEvent: BotEvent<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  execute(client, oldState, newState) {
    const guild = newState.guild;
    const player = client.lavalink.getPlayer(guild.id);
    if (!player?.voiceChannelId) return;

    const botChannelId = player.voiceChannelId;
    // Only care about changes involving the bot's channel.
    if (oldState.channelId !== botChannelId && newState.channelId !== botChannelId) return;

    const channel = guild.channels.cache.get(botChannelId);
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((m) => !m.user.bot).size;
    if (humans === 0) {
      startIdleTimer(client, player, "channel-empty");
      return;
    }

    cancelIdleTimer(guild.id, "channel-empty");
    // Someone came back but nothing is queued, so the usual empty-queue timer applies.
    if (!player.queue.current && player.queue.tracks.length === 0) {
      startIdleTimer(client, player, "queue-empty");
    }
  },
};
