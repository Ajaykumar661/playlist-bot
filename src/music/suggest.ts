/**
 * Search-as-you-type for /play and /playnext: suggestions appear while the user types.
 *
 * Apple Music is searched first so picks go through the ISRC matcher; YouTube Music is the fallback.
 * Each suggestion's value is a short link (Discord allows 100 characters), so /play loads exactly that song.
 * Discord waits at most 3 seconds for suggestions, so searches time out a bit before that.
 */
import type { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from "discord.js";
import type { SearchPlatform, Track, UnresolvedTrack } from "lavalink-client";
import { config } from "../config.js";
import { formatDuration, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../utils/types.js";

const MIN_CHARS = 2;
const MAX_SUGGESTIONS = 10;
const TIMEOUT_MS = 2_300;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 300;
const MAX_VALUE = 100; // Discord's limit for a choice name and value

type Choice = ApplicationCommandOptionChoiceData<string>;
const cache = new Map<string, { at: number; choices: Choice[] }>();

const looksLikeLink = (text: string) => /^https?:\/\//i.test(text) || /^spotify:/i.test(text);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref())]);
}

/** A short link that /play can load: Apple's /song/<id> form, or the track's own URL. */
function valueFor(track: Track | UnresolvedTrack): string | null {
  const { sourceName, identifier, uri } = track.info;
  if (sourceName === "applemusic" && identifier) return `https://music.apple.com/${config.appleMusicCountryCode}/song/${identifier}`;
  if (uri && uri.length <= MAX_VALUE) return uri;
  return null;
}

function toChoices(tracks: (Track | UnresolvedTrack)[]): Choice[] {
  const choices: Choice[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const value = valueFor(track);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const icon = track.info.sourceName === "applemusic" ? "🍎" : "▶️";
    const duration = track.info.duration ? ` · ${formatDuration(track.info.duration)}` : "";
    choices.push({ name: truncate(`${icon} ${track.info.title} — ${track.info.author}${duration}`, MAX_VALUE), value });
    if (choices.length >= MAX_SUGGESTIONS) break;
  }
  return choices;
}

async function search(client: BotClient, text: string): Promise<Choice[]> {
  const key = text.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.choices;

  const node = client.lavalink.nodeManager.leastUsedNodes()[0];
  if (!node) return [];
  const deadline = Date.now() + TIMEOUT_MS;
  const run = async (source: SearchPlatform) => {
    const left = deadline - Date.now();
    if (left < 300) return [];
    const result = await withTimeout(node.search({ query: text, source }, null).catch(() => null), left);
    return result && result.loadType !== "error" ? toChoices(result.tracks) : [];
  };

  let choices = await run("amsearch");
  if (choices.length === 0) choices = await run("ytmsearch");
  if (choices.length > 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), choices });
  }
  return choices;
}

export async function suggestTracks(interaction: AutocompleteInteraction<"cached">, client: BotClient): Promise<void> {
  const text = String(interaction.options.getFocused()).trim();
  const typedChoice: Choice[] = text && text.length <= MAX_VALUE ? [{ name: truncate(`🔍 ${text}`, MAX_VALUE), value: text }] : [];

  // Links and very short text: just offer what was typed.
  if (text.length < MIN_CHARS || looksLikeLink(text) || !client.lavalink.useable) {
    await interaction.respond(typedChoice).catch(() => undefined);
    return;
  }

  let results: Choice[] = [];
  try {
    results = await search(client, text);
  } catch (error) {
    logger.debug({ err: error, text }, "Autocomplete search failed");
  }
  // The typed text stays first, so pressing Enter without picking still does a normal search.
  // The interaction may already be stale (the user kept typing); that error is harmless.
  await interaction.respond([...typedChoice, ...results].slice(0, 25)).catch(() => undefined);
}
