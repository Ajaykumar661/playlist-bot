/**
 * Lyrics from LRCLIB (free, no API key, good coverage including Indian film songs): https://lrclib.net/docs
 * Plain lyrics for /lyrics, and time-synced (LRC) lyrics for the rolling view.
 */
import type { Track, UnresolvedTrack } from "lavalink-client";
import { getMatchData } from "./trackResolver.js";

const API = "https://lrclib.net/api";
const HEADERS = { "User-Agent": "apple-music-discord-bot/1.0 (self-hosted Discord bot)" };

export interface LrclibTrack {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB returned ${res.status}`);
  return (await res.json()) as T;
}

/** Drop "(feat. X)" / "(From "Film")" so LRCLIB finds the song. */
export const cleanLyricsTitle = (title: string) => title.replace(/\s*[([](?:feat|ft|from|with)[^)\]]*[)\]]/gi, "").trim();

/** Exact lookup (title + artist + duration) first, then a search. `preferSynced` picks a result with timings. */
export async function findLyrics(
  title: string,
  artist: string | null,
  durationSec: number | null,
  preferSynced = false,
): Promise<LrclibTrack | null> {
  const has = (r: LrclibTrack | null | undefined) => !!r && (preferSynced ? !!r.syncedLyrics : !!(r.plainLyrics || r.instrumental));
  if (artist) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (durationSec) params.set("duration", String(Math.round(durationSec)));
    const exact = await fetchJson<LrclibTrack>(`${API}/get?${params.toString()}`);
    if (has(exact) || (exact?.instrumental && preferSynced)) return exact;
  }
  const q = [artist, title].filter(Boolean).join(" ");
  const results = await fetchJson<LrclibTrack[]>(`${API}/search?${new URLSearchParams({ q }).toString()}`);
  return results?.find(has) ?? results?.find((r) => r.plainLyrics) ?? null;
}

/** Lyrics for a queued track, using the Apple/Spotify metadata when there is some (cleaner than YouTube titles). */
export function findLyricsForTrack(track: Track | UnresolvedTrack, preferSynced = false): Promise<LrclibTrack | null> {
  const meta = getMatchData(track)?.apple;
  const title = cleanLyricsTitle(meta?.title ?? track.info.title);
  const artist = (meta?.artist ?? track.info.author)?.split(/,|&/)[0]?.trim() ?? null;
  const durationMs = meta?.durationMs ?? track.info.duration;
  return findLyrics(title, artist, durationMs ? durationMs / 1000 : null, preferSynced);
}

/** Parse LRC ("[01:23.45] text", several time tags per line allowed) into lines sorted by time. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (tags.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const [, min, sec, frac = "0"] of tags) {
      const ms = Number(frac.padEnd(3, "0").slice(0, 3));
      lines.push({ timeMs: (Number(min) * 60 + Number(sec)) * 1000 + ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the line being sung at `positionMs` (-1 before the first line). */
export function currentLineIndex(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.timeMs <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
