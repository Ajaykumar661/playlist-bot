/**
 * Sound quality checks used by /quality and /volume.
 *
 * What decides how good the bot sounds:
 *  1. Which YouTube format Lavalink gets. lavalink/application.yml puts the IOS client first because
 *     it still gets audio-only formats; the others fall back to the 360p video file (itag 18).
 *  2. Volume above 100% boosts the signal and can clip (distort) loud songs.
 *  3. Filters change the sound on purpose (and re-encode it).
 * Discord forwards the bot's audio as-is, so the voice channel's bitrate setting doesn't affect it.
 */
import type { Player } from "lavalink-client";

export const BEST_VOLUME = 100;

export const mayClip = (player: Player) => player.volume > BEST_VOLUME;
export const activeFilter = (player: Player) => player.get<string | null>("filter") ?? null;
