/**
 * Pick a song from the queue or the history: dropdown menus under /queue and /history,
 * and the autocomplete list for /playqueue, /jump and /history.
 *
 * Menus are handled here (not by a collector), so they keep working on older messages.
 * Each option stores the track's position and identifier; if the queue changed since the menu
 * was posted, the track is found again by its identifier.
 */
import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Player, Track, UnresolvedTrack } from "lavalink-client";
import { errorEmbed, infoEmbed } from "../utils/embeds.js";
import { formatDuration, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../utils/types.js";
import { playFromHistory, playFromQueue, type ActionResult } from "./actions.js";

type AnyTrack = Track | UnresolvedTrack;
type PickList = "queue" | "history";

export const PICK_PREFIX = "pick:";
const MAX_OPTIONS = 25; // Discord's limit for menus and autocomplete

export const isPickMenu = (customId: string) => customId.startsWith(PICK_PREFIX);

function label(track: AnyTrack, position: number, max: number): string {
  return truncate(`${position}. ${track.info.title ?? "Unknown"} — ${track.info.author ?? "Unknown"}`, max);
}

function menu(list: PickList, placeholder: string, entries: { track: AnyTrack; index: number }[]) {
  if (entries.length === 0) return null;
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PICK_PREFIX}${list}`)
      .setPlaceholder(placeholder)
      .addOptions(
        entries.map(({ track, index }) => ({
          label: label(track, index + 1, 100),
          description: `${formatDuration(track.info.duration ?? 0)}`,
          value: `${index}|${(track.info.identifier ?? "").slice(0, 80)}`,
        })),
      ),
  );
}

/** Dropdown for one page of /queue: picking a song plays it now. */
export function queuePickRow(player: Player, page: number, pageSize: number) {
  const start = page * pageSize;
  const entries = player.queue.tracks.slice(start, start + pageSize).map((track, i) => ({ track, index: start + i }));
  return menu("queue", "▶️ Pick a song from this page to play it now", entries);
}

/** Dropdown for /history: picking a song plays it again. */
export function historyPickRow(player: Player) {
  const entries = player.queue.previous.slice(0, MAX_OPTIONS).map((track, index) => ({ track, index }));
  return menu("history", "⏮️ Pick a song to play it again", entries);
}

/** Autocomplete choices: matching tracks by title, artist or number. Value = 1-based position. */
export async function respondWithTracks(interaction: AutocompleteInteraction, tracks: AnyTrack[]): Promise<void> {
  const typed = String(interaction.options.getFocused()).trim().toLowerCase();
  const choices: ApplicationCommandOptionChoiceData<number>[] = [];
  for (let i = 0; i < tracks.length && choices.length < MAX_OPTIONS; i++) {
    const t = tracks[i]!;
    const text = `${i + 1} ${t.info.title} ${t.info.author}`.toLowerCase();
    if (!typed || text.includes(typed)) choices.push({ name: label(t, i + 1, 100), value: i + 1 });
  }
  await interaction.respond(choices).catch(() => undefined);
}

/** Find the picked track again, even if the queue moved since the menu was posted. */
function findIndex(tracks: AnyTrack[], value: string): number {
  const [rawIndex, identifier = ""] = value.split("|");
  const index = Number(rawIndex);
  const matches = (t: AnyTrack | undefined) => !!t && (t.info.identifier ?? "").slice(0, 80) === identifier;
  if (matches(tracks[index])) return index;
  return tracks.findIndex(matches);
}

export async function handlePickMenu(interaction: StringSelectMenuInteraction<"cached">, client: BotClient): Promise<void> {
  const list = interaction.customId.slice(PICK_PREFIX.length) as PickList;
  const player = client.lavalink.getPlayer(interaction.guildId);
  const deny = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

  if (!player) return void (await deny("Nothing is playing right now. Use `/play` to start."));
  const memberChannel = interaction.member.voice.channelId;
  if (memberChannel !== player.voiceChannelId) {
    return void (await deny(`You need to be in <#${player.voiceChannelId}> to pick songs.`));
  }

  const tracks = list === "history" ? player.queue.previous : player.queue.tracks;
  const index = findIndex(tracks, interaction.values[0] ?? "");
  if (index < 0) return void (await deny("That song isn't in the list anymore. Open it again to see the current songs."));

  let result: ActionResult;
  try {
    result = list === "history" ? await playFromHistory(player, index) : await playFromQueue(player, index);
  } catch (error) {
    logger.error({ err: error, list }, "Pick menu failed");
    return void (await deny("That didn't work. Please try again."));
  }
  if (!result.ok) return void (await deny(result.message));

  await interaction.reply({ embeds: [infoEmbed(`${result.message} — <@${interaction.user.id}>`)], allowedMentions: { parse: [] } });
  // trackStart posts the new now-playing message.
}
