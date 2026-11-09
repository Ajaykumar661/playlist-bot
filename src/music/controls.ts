import { MessageFlags, type ButtonInteraction } from "discord.js";
import { errorEmbed, infoEmbed } from "../utils/embeds.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../utils/types.js";
import {
  cycleLoop,
  previousTrack,
  shuffleQueue,
  skipTrack,
  stopPlayer,
  togglePause,
  toggleAutoplay,
  type ActionResult,
} from "./actions.js";
import { CONTROL_PREFIX, isLiveMessage, playerView, setQueuePage, toggleQueue, type ControlId } from "./nowPlaying.js";
import { buildQueueEmbed, clampPage, pageFromButton, queueComponents } from "./queueView.js";
import { startLiveLyrics } from "./liveLyrics.js";

/** Buttons that change state but keep the same track: re-render the message in place. */
const IN_PLACE = new Set<ControlId>(["pause", "queue", "shuffle", "loop", "autoplay"]);

export function isControlButton(interaction: ButtonInteraction): boolean {
  return interaction.customId.startsWith(CONTROL_PREFIX);
}

export async function handleControlButton(interaction: ButtonInteraction<"cached">, client: BotClient): Promise<void> {
  const id = interaction.customId.slice(CONTROL_PREFIX.length) as ControlId;
  const player = client.lavalink.getPlayer(interaction.guildId);

  const deny = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

  if (!player?.queue.current || !isLiveMessage(interaction.guildId, interaction.message.id)) {
    await interaction.update({ components: [] }).catch(() => undefined);
    return;
  }

  // Same rule as slash commands: you must be listening to use the controls (except the queue and lyrics).
  if (id !== "queue" && id !== "lyrics") {
    const memberChannel = interaction.member.voice.channelId;
    if (!memberChannel) return void (await deny("Join the voice channel to use the controls."));
    if (memberChannel !== player.voiceChannelId) {
      return void (await deny(`You need to be in <#${player.voiceChannelId}> to use the controls.`));
    }
  }

  let result: ActionResult;
  try {
    switch (id) {
      case "queue":
        // Show or hide the queue inside this message.
        toggleQueue(player);
        result = { ok: true, message: "" };
        break;
      case "previous":
        result = await previousTrack(player);
        break;
      case "pause":
        result = await togglePause(player);
        break;
      case "skip":
        result = await skipTrack(player);
        break;
      case "stop":
        result = await stopPlayer(player);
        break;
      case "shuffle":
        result = await shuffleQueue(player);
        break;
      case "loop":
        result = await cycleLoop(player);
        break;
      case "autoplay":
        result = toggleAutoplay(player);
        break;
      case "lyrics": {
        // Rolling lyrics for this song, in a new message under the player.
        const reply = await interaction.reply({ embeds: [infoEmbed("🎤 Looking up lyrics…")], withResponse: true });
        const message = reply.resource?.message;
        if (message) startLiveLyrics(client, interaction.guildId, message);
        return;
      }
      default:
        return void (await deny("Unknown button."));
    }
  } catch (error) {
    logger.error({ err: error, button: id }, "Control button failed");
    return void (await deny("That didn't work. Please try again."));
  }

  if (!result.ok) return void (await deny(result.message));

  const track = player.queue.current;
  if (IN_PLACE.has(id) && track) {
    await interaction.update(playerView(player, track));
    return;
  }

  // Skip / previous / stop: a new now-playing message (or none) follows, so just say who did it.
  await interaction.reply({
    embeds: [infoEmbed(`${result.message} — <@${interaction.user.id}>`)],
    allowedMentions: { parse: [] },
  });
}

/**
 * ◀️ ▶️ queue page buttons. On the now-playing message they flip the queue shown inside it;
 * on a /queue message they flip that message (or show a private copy to someone else).
 */
export async function handleQueuePageButton(interaction: ButtonInteraction<"cached">, client: BotClient): Promise<void> {
  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    await interaction.update({ embeds: [infoEmbed("The queue is gone.")], components: [] });
    return;
  }
  const page = clampPage(player, pageFromButton(interaction.customId));

  const track = player.queue.current;
  if (track && isLiveMessage(interaction.guildId, interaction.message.id)) {
    setQueuePage(player, page);
    await interaction.update(playerView(player, track));
    return;
  }

  const view = { embeds: [buildQueueEmbed(player, page)], components: queueComponents(player, page) };
  const owner = interaction.message.interactionMetadata?.user.id;
  if (owner && owner !== interaction.user.id) {
    await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(view);
}
