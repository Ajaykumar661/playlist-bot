/**
 * "What should I do with this song?" buttons: ▶️ Play now · ⏭️ Play next · ➕ Add to queue.
 *
 * Asked when someone picks a song from a list (queue, history, /search results) or uses /play for
 * one song while something is already playing.
 *  - Songs already in the queue or history are found again by position + identifier (no state kept).
 *  - New songs (from /play or /search) are kept in memory for a few minutes under a short token.
 */
import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import type { Player, Track, UnresolvedTrack } from "lavalink-client";
import { Colors, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../utils/types.js";
import { addTracks, moveToFront, playFromHistory, playFromQueue, type ActionResult, type AddMode } from "./actions.js";
import { cancelIdleTimer } from "./idleManager.js";
import { refreshNowPlaying } from "./nowPlaying.js";

type AnyTrack = Track | UnresolvedTrack;
export type ListName = "queue" | "history";

export const CHOICE_PREFIX = "choice:";
export const isChoiceButton = (customId: string) => customId.startsWith(CHOICE_PREFIX);
export const PENDING_TTL_MS = 5 * 60_000;
/** Identifiers are cut to this length so custom ids stay under Discord's 100-character limit. */
export const ID_CHARS = 60;

const shortId = (track: AnyTrack) => (track.info.identifier ?? "").slice(0, ID_CHARS);

/** Find a track again in a list, even if the list moved since the buttons were posted. */
export function findTrack(tracks: AnyTrack[], index: number, identifier: string): number {
  const matches = (t: AnyTrack | undefined) => !!t && shortId(t) === identifier;
  if (matches(tracks[index])) return index;
  return tracks.findIndex(matches);
}

// ---------- the prompt ----------

const BUTTONS: Record<AddMode, { emoji: string; label: string; style: ButtonStyle }> = {
  now: { emoji: "▶️", label: "Play now", style: ButtonStyle.Success },
  next: { emoji: "⏭️", label: "Play next", style: ButtonStyle.Primary },
  end: { emoji: "➕", label: "Add to queue", style: ButtonStyle.Secondary },
};

function promptView(tracks: AnyTrack[], modes: AddMode[], ref: string) {
  const first = tracks[0]!;
  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setAuthor({ name: "What should I do with this song?" })
    .setTitle(truncate(first.info.title ?? "Unknown", 250))
    .setDescription(`by **${escapeMd(first.info.author ?? "Unknown")}** · \`${formatDuration(first.info.duration ?? 0)}\``);
  if (first.info.artworkUrl) embed.setThumbnail(first.info.artworkUrl);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    modes.map((mode) =>
      new ButtonBuilder()
        .setCustomId(`${CHOICE_PREFIX}${mode}:${ref}`)
        .setEmoji(BUTTONS[mode].emoji)
        .setLabel(BUTTONS[mode].label)
        .setStyle(BUTTONS[mode].style),
    ),
  );
  return { embeds: [embed], components: [row] };
}

/** Prompt for a song already in the queue (play now / next) or the history (now / next / end). */
export function listPrompt(list: ListName, tracks: AnyTrack[], index: number): InteractionReplyOptions {
  const track = tracks[index]!;
  const modes: AddMode[] = list === "queue" ? ["now", "next"] : ["now", "next", "end"];
  return { ...promptView([track], modes, `${list}:${index}|${shortId(track)}`), flags: MessageFlags.Ephemeral };
}

interface Pending {
  tracks: AnyTrack[];
  userId: string;
  guildId: string;
  timer: NodeJS.Timeout;
}
const pending = new Map<string, Pending>();

/**
 * Prompt for new songs. Only `userId` can answer. `onExpire` runs if nobody answers in time
 * (e.g. to remove the buttons from the message).
 */
export function newTracksPrompt(
  guildId: string,
  userId: string,
  tracks: AnyTrack[],
  onExpire: () => void,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const token = randomBytes(6).toString("hex");
  const timer = setTimeout(() => {
    if (pending.delete(token)) onExpire();
  }, PENDING_TTL_MS);
  timer.unref();
  pending.set(token, { tracks, userId, guildId, timer });
  return promptView(tracks, ["now", "next", "end"], `new:${token}`);
}

// ---------- answering ----------

export async function handleChoiceButton(interaction: ButtonInteraction<"cached">, client: BotClient): Promise<void> {
  // choice:<mode>:<kind>:<ref>
  const [, rawMode, kind, ...rest] = interaction.customId.split(":");
  const mode = rawMode as AddMode;
  const ref = rest.join(":");
  const deny = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    await interaction.update({ embeds: [errorEmbed("Nothing is playing anymore. Use `/play` to start again.")], components: [] });
    return;
  }
  if (interaction.member.voice.channelId !== player.voiceChannelId) {
    return void (await deny(`You need to be in <#${player.voiceChannelId}> to do that.`));
  }

  let result: ActionResult;
  try {
    if (kind === "new") {
      const entry = pending.get(ref);
      if (!entry) {
        await interaction.update({ embeds: [errorEmbed("This choice expired. Search for the song again.")], components: [] });
        return;
      }
      if (entry.userId !== interaction.user.id) return void (await deny("Only the person who picked this song can choose."));
      pending.delete(ref);
      clearTimeout(entry.timer);
      cancelIdleTimer(interaction.guildId);
      result = await addTracks(player, entry.tracks, mode);
    } else {
      result = await answerListChoice(player, kind as ListName, ref, mode);
    }
  } catch (error) {
    logger.error({ err: error, customId: interaction.customId }, "Choice button failed");
    return void (await deny("That didn't work. Please try again."));
  }

  await interaction.update({
    embeds: [result.ok ? infoEmbed(`${result.message} — <@${interaction.user.id}>`) : errorEmbed(result.message)],
    components: [],
    allowedMentions: { parse: [] },
  });
  // "Play now" posts a new now-playing message on its own; the others only change the queue.
  if (result.ok && mode !== "now") await refreshNowPlaying(client, player);
}

async function answerListChoice(player: Player, list: ListName, ref: string, mode: AddMode): Promise<ActionResult> {
  const [rawIndex, identifier = ""] = ref.split("|");
  const tracks = list === "history" ? player.queue.previous : player.queue.tracks;
  const index = findTrack(tracks, Number(rawIndex), identifier);
  if (index < 0) return { ok: false, message: "That song isn't in the list anymore." };

  if (list === "queue") return mode === "now" ? playFromQueue(player, index) : moveToFront(player, index);
  if (mode === "now") return playFromHistory(player, index);
  return addTracks(player, [tracks[index]!], mode);
}
