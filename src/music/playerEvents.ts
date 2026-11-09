import type { LavalinkManager, Player, Track, UnresolvedTrack } from "lavalink-client";
import { logger } from "../utils/logger.js";
import { infoEmbed, warnEmbed } from "../utils/embeds.js";
import { escapeMd, pluralize, truncate } from "../utils/format.js";
import type { BotClient } from "../utils/types.js";
import { cancelIdleTimer, startIdleTimer } from "./idleManager.js";
import { dedupeHistory } from "./actions.js";
import { stopLiveLyrics } from "./liveLyrics.js";
import { sendToPlayerChannel } from "./notify.js";
import { prefetchNext } from "./trackResolver.js";
import { postNowPlaying, refreshNowPlaying, retireNowPlaying } from "./nowPlaying.js";

/**
 * After this many failures in a row (no track starts in between), stop instead of burning
 * through the rest of the queue. This usually means YouTube is blocking the server.
 */
const MAX_CONSECUTIVE_FAILURES = 8;
const MAX_LISTED_FAILURES = 10;

interface FailureLog {
  titles: string[];
  consecutive: number;
}

const failures = new Map<string, FailureLog>();

function getLog(guildId: string): FailureLog {
  let log = failures.get(guildId);
  if (!log) {
    log = { titles: [], consecutive: 0 };
    failures.set(guildId, log);
  }
  return log;
}

function describe(track: Track | UnresolvedTrack | null): string {
  if (!track) return "Unknown track";
  const title = track.info.title ?? "Unknown title";
  return track.info.author ? `${title} — ${track.info.author}` : title;
}

/** Post the "N tracks couldn't be found" summary (if any) and reset the counter. */
export async function flushFailureReport(client: BotClient, player: Player): Promise<void> {
  const log = failures.get(player.guildId);
  if (!log || log.titles.length === 0) return;
  failures.delete(player.guildId);

  const shown = log.titles.slice(0, MAX_LISTED_FAILURES).map((t) => `• ${escapeMd(truncate(t, 80))}`);
  const more = log.titles.length - shown.length;
  if (more > 0) shown.push(`…and ${more} more`);

  await sendToPlayerChannel(client, player, {
    embeds: [
      warnEmbed(
        `**${pluralize(log.titles.length, "track")} couldn't be found** and ${log.titles.length === 1 ? "was" : "were"} skipped:\n${shown.join("\n")}`,
      ),
    ],
  });
}

async function recordFailure(
  client: BotClient,
  player: Player,
  track: Track | UnresolvedTrack | null,
  detail: string,
): Promise<void> {
  const log = getLog(player.guildId);
  log.titles.push(describe(track));
  log.consecutive += 1;
  logger.warn({ guildId: player.guildId, track: describe(track), detail }, "Track failed, skipping");

  if (log.consecutive >= MAX_CONSECUTIVE_FAILURES) {
    logger.error({ guildId: player.guildId }, "Too many consecutive failures, stopping playback");
    await player.stopPlaying(true, false).catch(() => undefined);
    await sendToPlayerChannel(client, player, {
      embeds: [
        warnEmbed(
          `${MAX_CONSECUTIVE_FAILURES} tracks in a row failed to play, so I stopped. ` +
            "YouTube may be blocking the server. See README > Troubleshooting.",
        ),
      ],
    });
    await flushFailureReport(client, player);
    startIdleTimer(client, player, "queue-empty");
  }
}

export function registerPlayerEvents(client: BotClient, manager: LavalinkManager): void {
  manager.on("trackStart", (player, track) => {
    getLog(player.guildId).consecutive = 0;
    cancelIdleTimer(player.guildId, "queue-empty");
    // Match the next Apple track now so it starts without a search delay.
    prefetchNext(player);
    if (!track) return;

    // While looping a single track, keep the same message instead of reposting it each time.
    if (player.repeatMode === "track" && player.get<string>("lastAnnounced") === track.encoded) {
      void refreshNowPlaying(client, player);
      return;
    }
    player.set("lastAnnounced", track.encoded ?? "");
    void postNowPlaying(client, player, track);
  });

  manager.on("trackEnd", (player) => dedupeHistory(player));

  manager.on("trackError", (player, track, payload) => {
    // Usually a Lavalink TrackExceptionEvent. The library passes a plain Error when resolving fails.
    const raw = payload as unknown;
    const detail =
      raw instanceof Error
        ? raw.message
        : (payload?.exception?.message ?? payload?.exception?.cause ?? "unknown error");
    void recordFailure(client, player, track, detail);
  });

  manager.on("trackStuck", (player, track, payload) => {
    void recordFailure(client, player, track, `stuck for ${payload.thresholdMs}ms`);
  });

  manager.on("queueEnd", (player) => {
    void (async () => {
      await retireNowPlaying(client, player.guildId);
      await flushFailureReport(client, player);
      await sendToPlayerChannel(client, player, {
        embeds: [
          infoEmbed(
            player.get<boolean>("stay247")
              ? "🎶 The queue is finished. Add more with `/play`. 24/7 mode is on, so I'll stay."
              : "🎶 The queue is finished. Add more with `/play` (or turn on `/autoplay`), or I'll leave in 3 minutes.",
          ),
        ],
      });
      startIdleTimer(client, player, "queue-empty");
    })();
  });

  manager.on("playerDestroy", (player, reason) => {
    logger.info({ guildId: player.guildId, reason }, "Player destroyed");
    cancelIdleTimer(player.guildId);
    failures.delete(player.guildId);
    stopLiveLyrics(player.guildId);
    void retireNowPlaying(client, player.guildId);
  });

  manager.on("playerMove", (player, oldChannel, newChannel) => {
    logger.info({ guildId: player.guildId, oldChannel, newChannel }, "Player moved to another voice channel");
  });
}
