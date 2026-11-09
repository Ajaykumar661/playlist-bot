/**
 * /autoplay: when the queue runs out, add songs from YouTube's "Mix" (radio) for the last track.
 * lavalink-client calls this from its queue-end handling and starts playback if we add anything.
 */
import type { Player, Track } from "lavalink-client";
import { logger } from "../utils/logger.js";
import type { Requester } from "../utils/types.js";

const ADD_COUNT = 5;

export function createAutoplay(botUser: () => Requester) {
  return async (player: Player, lastTrack: Track): Promise<void> => {
    if (!player.get<boolean>("autoplay") || !lastTrack) return;
    try {
      const seedId = await youtubeIdFor(player, lastTrack);
      if (!seedId) return;

      const res = await player.search({ query: `https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}` }, botUser());
      const recent = new Set(
        [lastTrack, ...player.queue.previous].flatMap((t) => [t.info.identifier, normalizeTitle(t.info.title)]),
      );
      const picks = res.tracks
        .filter((t): t is Track => typeof t.encoded === "string")
        .filter((t) => !t.info.isStream && t.info.duration > 60_000 && t.info.duration < 15 * 60_000)
        .filter((t) => !recent.has(t.info.identifier) && !recent.has(normalizeTitle(t.info.title)))
        .slice(0, ADD_COUNT);

      if (picks.length === 0) return;
      await player.queue.add(picks);
      logger.info({ guildId: player.guildId, seed: seedId, added: picks.length }, "Autoplay added tracks");
    } catch (error) {
      logger.warn({ err: error, guildId: player.guildId }, "Autoplay failed");
    }
  };
}

/** Matched Apple/Spotify tracks already carry the YouTube id; otherwise search for one. */
async function youtubeIdFor(player: Player, track: Track): Promise<string | null> {
  if (track.info.sourceName === "youtube" || track.info.sourceName === "youtubemusic") return track.info.identifier;
  const res = await player.search({ query: `${track.info.author} ${track.info.title}`, source: "ytmsearch" }, track.requester);
  return res.tracks[0]?.info.identifier ?? null;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
