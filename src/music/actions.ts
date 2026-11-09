/**
 * Player actions shared by slash commands and the now-playing buttons, so both behave the same.
 * Each returns a short user-facing message; `ok: false` means nothing changed.
 */
import type { Player, RepeatMode } from "lavalink-client";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
const title = (t: { info: { title: string } } | null | undefined) => escapeMd(truncate(t?.info.title ?? "track", 80));

export const VOLUME_STEP = 10;
export const MAX_VOLUME = 150;

export async function skipTrack(player: Player): Promise<ActionResult> {
  const current = player.queue.current;
  if (!current) return fail("Nothing is playing.");
  if (player.queue.tracks.length === 0) {
    // No next track: stop (queueEnd starts the idle timer, or autoplay adds more).
    await player.stopPlaying(false, true);
    return ok(`⏭️ Skipped **${title(current)}**. That was the last track.`);
  }
  await player.skip(0, false);
  return ok(`⏭️ Skipped **${title(current)}**.`);
}

/**
 * Go back to the previously played track. The current track goes back to the front of the queue,
 * so pressing ⏮️ several times walks back through the history and ⏭️ walks forward again.
 */
export function previousTrack(player: Player): Promise<ActionResult> {
  if (player.queue.previous.length === 0) return Promise.resolve(fail("There's no previous track yet."));
  return playFromHistory(player, 0);
}

/** Play a track from the history (`index` 0 = the most recently played). */
export async function playFromHistory(player: Player, index: number): Promise<ActionResult> {
  const target = player.queue.previous[index];
  if (!target) return fail("That song isn't in the history anymore.");
  player.queue.previous.splice(index, 1);
  if (player.queue.current) await player.queue.add(player.queue.current, 0);
  await player.play({ clientTrack: target, paused: false });
  return ok(`⏮️ Back to **${title(target)}**.`);
}

/**
 * Play a queued track right now. The tracks before it stay in the queue (unlike /jump),
 * and the current track goes into the history so ⏮️ can return to it.
 */
export async function playFromQueue(player: Player, index: number): Promise<ActionResult> {
  const target = player.queue.tracks[index];
  if (!target) return fail(`There are only ${player.queue.tracks.length} tracks in the queue.`);
  await player.queue.splice(index, 1);
  rememberPlayed(player, player.queue.current);
  await player.play({ clientTrack: target, paused: false });
  return ok(`▶️ Playing **${title(target)}** now.`);
}

/** Move a queued track to the front, so it plays after the current one. */
export async function moveToFront(player: Player, index: number): Promise<ActionResult> {
  const target = player.queue.tracks[index];
  if (!target) return fail("That song isn't in the queue anymore.");
  if (index > 0) {
    await player.queue.splice(index, 1);
    await player.queue.add(target, 0);
  }
  return ok(`⏭️ **${title(target)}** plays next.`);
}

export type AddMode = "now" | "next" | "end";
type QueueTrack = Player["queue"]["tracks"][number];

/** Add new tracks: play now, play next, or at the end of the queue. Starts playback if nothing is playing. */
export async function addTracks(player: Player, tracks: QueueTrack[], mode: AddMode): Promise<ActionResult> {
  const first = tracks[0];
  if (!first) return fail("Nothing to add.");
  const name = tracks.length === 1 ? `**${title(first)}**` : `**${tracks.length} songs**`;
  const idle = !player.queue.current && !player.playing;

  if (mode === "end") await player.queue.add(tracks);
  else await player.queue.add(tracks, 0);

  if (idle) {
    await player.play();
    return ok(`▶️ Playing ${name}.`);
  }
  if (mode === "now") {
    const result = await playFromQueue(player, 0);
    return result.ok ? ok(`▶️ Playing ${name} now.`) : result;
  }
  return ok(mode === "next" ? `⏭️ ${name} plays next.` : `➕ Added ${name} at position ${player.queue.tracks.length - tracks.length + 1}.`);
}

/**
 * Add a track to the history. The library only does this when a track ends by itself or is skipped,
 * not when it's replaced by play({ clientTrack }).
 */
function rememberPlayed(player: Player, track: Player["queue"]["current"]): void {
  if (!track || player.queue.previous[0] === track) return;
  player.queue.previous.unshift(track);
  const max = player.queue.options.maxPreviousTracks;
  if (player.queue.previous.length > max) player.queue.previous.splice(max);
  void player.queue.utils.save();
}

/** While looping one track the library adds it to the history on every repeat. Keep just one copy. */
export function dedupeHistory(player: Player): void {
  const [latest, before] = player.queue.previous;
  if (latest && before && latest.info.identifier === before.info.identifier) player.queue.previous.splice(1, 1);
}

export async function togglePause(player: Player): Promise<ActionResult> {
  if (!player.queue.current) return fail("Nothing is playing.");
  if (player.paused) {
    await player.resume();
    return ok("▶️ Resumed.");
  }
  await player.pause();
  return ok("⏸️ Paused.");
}

export async function stopPlayer(player: Player): Promise<ActionResult> {
  await player.destroy("StopCommand");
  return ok("⏹️ Stopped, cleared the queue and left the voice channel.");
}

export async function shuffleQueue(player: Player): Promise<ActionResult> {
  const count = player.queue.tracks.length;
  if (count < 2) return fail("There need to be at least 2 tracks in the queue to shuffle.");
  await player.queue.shuffle();
  return ok(`🔀 Shuffled ${count} tracks.`);
}

const LOOP_ORDER: RepeatMode[] = ["off", "queue", "track"];
export const LOOP_MESSAGES: Record<RepeatMode, string> = {
  off: "➡️ Looping is off.",
  track: "🔂 Looping the current track.",
  queue: "🔁 Looping the whole queue.",
};

export async function cycleLoop(player: Player): Promise<ActionResult> {
  const next = LOOP_ORDER[(LOOP_ORDER.indexOf(player.repeatMode) + 1) % LOOP_ORDER.length]!;
  await player.setRepeatMode(next);
  return ok(LOOP_MESSAGES[next]);
}

export async function setVolume(player: Player, level: number): Promise<ActionResult> {
  const clamped = Math.max(0, Math.min(MAX_VOLUME, Math.round(level)));
  await player.setVolume(clamped);
  const icon = clamped === 0 ? "🔇" : clamped < 50 ? "🔈" : clamped < 100 ? "🔉" : "🔊";
  return ok(`${icon} Volume **${clamped}%**.`);
}

export const changeVolume = (player: Player, delta: number) => setVolume(player, player.volume + delta);

export async function seekTo(player: Player, positionMs: number): Promise<ActionResult> {
  const track = player.queue.current;
  if (!track) return fail("Nothing is playing.");
  if (track.info.isStream || !track.info.isSeekable) return fail("This track can't be seeked.");
  const target = Math.max(0, Math.min(positionMs, Math.max(0, track.info.duration - 1_000)));
  await player.seek(target);
  return ok(`⏩ Jumped to \`${formatDuration(target)} / ${formatDuration(track.info.duration)}\`.`);
}

export function toggleAutoplay(player: Player): ActionResult {
  const on = !player.get<boolean>("autoplay");
  player.set("autoplay", on);
  return ok(on ? "♾️ Autoplay **on**: when the queue runs out I'll keep playing similar songs." : "♾️ Autoplay **off**.");
}

/** Parse "1:23", "01:02:03", "83", "83s", "1m23s". Returns ms, or null. */
export function parseTime(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(":").map(Number);
    let seconds = 0;
    for (const p of parts) seconds = seconds * 60 + p;
    return seconds * 1000;
  }
  const units = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s?)?$/.exec(text);
  if (units && (units[1] || units[2] || units[3])) {
    const [h, m, s] = [units[1], units[2], units[3]].map((v) => Number(v ?? 0));
    return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000;
  }
  return null;
}
