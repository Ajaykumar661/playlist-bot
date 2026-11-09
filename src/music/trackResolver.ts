/**
 * Custom Apple Music → YouTube matching.
 *
 * Apple tracks from LavaSrc are queued as "unresolved" tracks. lavalink-client calls resolve()
 * right before a track plays (and we prefetch the next one), which runs:
 *   1. SQLite cache (by ISRC or Apple track id)
 *   2. ISRC: dzisrc (if Deezer is enabled), then ytmsearch "<ISRC>" (verified with the scorer)
 *   3. ytmsearch "<artist> <title>" → score the top N (matcher.ts) → embedding rerank on near-ties
 *   4. Nothing good enough → play the Apple track itself so LavaSrc's own provider chain gets a try
 * resolve() never throws: any error falls through to step 4.
 */
import type { Player, SearchPlatform, Track, TrackInfo, UnresolvedTrack } from "lavalink-client";

type SourceName = TrackInfo["sourceName"];
import { logger } from "../utils/logger.js";
import { truncate } from "../utils/format.js";
import { cosineSimilarities } from "./embeddings.js";
import { MatchCache } from "./matchCache.js";
import {
  applyRerank,
  formatBreakdown,
  rankCandidates,
  rerankPool,
  scoreCandidate,
  sourceEmbeddingText,
  type Candidate,
  type ScoredCandidate,
  type SourceTrack,
} from "./matcher.js";
import type { MatchingConfig } from "./matchingConfig.js";

export type MatchMethod = "cache" | "isrc-deezer" | "isrc-youtube" | "search" | "lavasrc";

/**
 * Metadata of a catalogue track (Apple Music or Spotify, via LavaSrc), kept on every queued track
 * (in userData) so /wrong can re-match it. Named "Apple" for history; Spotify tracks use it too.
 */
export interface AppleMeta {
  [key: string]: string | number | null;
  /** "applemusic" or "spotify" */
  source: string;
  /** Apple or Spotify track id */
  appleId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isrc: string | null;
  artworkUrl: string | null;
  uri: string | null;
  /** LavaSrc's own encoded Apple track, used for the fallback. */
  encoded: string;
}

export interface MatchInfo {
  [key: string]: string | number | null;
  method: MatchMethod;
  videoId: string | null;
  ytTitle: string | null;
  ytAuthor: string | null;
  score: number | null;
}

interface MatchUserData {
  apple: AppleMeta;
  match?: MatchInfo;
}

interface Resolved {
  track: Track;
  info: MatchInfo;
}

type CandidateWithTrack = Candidate & { track: Track };

interface ResolverState {
  cfg: MatchingConfig;
  cache: MatchCache;
  deezerEnabled: boolean;
}

let state: ResolverState | null = null;

export function initTrackResolver(cfg: MatchingConfig, deezerEnabled: boolean): MatchCache {
  const cache = new MatchCache(cfg.cache);
  state = { cfg, cache, deezerEnabled };
  return cache;
}

function getState(): ResolverState {
  if (!state) throw new Error("Track resolver not initialised");
  return state;
}

// ---------- helpers ----------

/** LavaSrc catalogue sources whose tracks have no audio and go through our matcher. */
const MIRRORED_SOURCES = new Set(["applemusic", "spotify"]);

export function isAppleTrack(track: Track | UnresolvedTrack): boolean {
  return MIRRORED_SOURCES.has(track.info.sourceName ?? "");
}

export function appleMetaFromTrack(track: Track | UnresolvedTrack): AppleMeta {
  const info = track.info;
  return {
    source: info.sourceName ?? "applemusic",
    appleId: info.identifier ?? "",
    title: info.title,
    artist: info.author ?? "",
    album: track.pluginInfo?.albumName ?? null,
    durationMs: info.duration ?? 0,
    isrc: info.isrc ?? null,
    artworkUrl: info.artworkUrl ?? null,
    uri: info.uri ?? null,
    encoded: track.encoded ?? "",
  };
}

export function matchKeys(meta: AppleMeta): string[] {
  const keys: string[] = [];
  if (meta.isrc) keys.push(`isrc:${meta.isrc.toUpperCase()}`);
  if (meta.appleId) keys.push(`${meta.source === "spotify" ? "sp" : "am"}:${meta.appleId}`);
  return keys;
}

export function getMatchData(track: Track | UnresolvedTrack | null | undefined): MatchUserData | null {
  const data = track?.userData as unknown as Partial<MatchUserData> | undefined;
  return data?.apple ? (data as MatchUserData) : null;
}

function toSource(meta: AppleMeta): SourceTrack {
  return { title: meta.title, artist: meta.artist, album: meta.album, durationMs: meta.durationMs, isrc: meta.isrc };
}

function toCandidate(track: Track): CandidateWithTrack {
  return {
    id: track.info.identifier,
    title: track.info.title,
    author: track.info.author,
    durationMs: track.info.duration,
    track,
  };
}

const label = (meta: AppleMeta) => `${meta.artist} - ${meta.title}`;

/** 'Shilpa Rao, Anirudh & X' + 'Kaavaalaa (From "Jailer") [feat. Y]' → 'Shilpa Rao Kaavaalaa (From "Jailer")' */
export function searchQuery(meta: Pick<AppleMeta, "artist" | "title">): string {
  const mainArtist = meta.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b)\s*/iu)[0]?.trim() || meta.artist;
  const title = meta.title.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/giu, "").trim();
  return `${mainArtist} ${title}`.trim();
}

// ---------- queue entries ----------

/**
 * Wrap a LavaSrc Apple track in an unresolved track whose resolve() runs our matcher.
 * Display info (title, artist, artwork) stays Apple's; playback uses the matched YouTube track.
 */
export function createAppleTrack(meta: AppleMeta, requester: unknown): UnresolvedTrack {
  let pending: Promise<void> | null = null;

  const entry: UnresolvedTrack = {
    encoded: undefined,
    info: {
      title: meta.title,
      author: meta.artist,
      duration: meta.durationMs,
      artworkUrl: meta.artworkUrl,
      uri: meta.uri ?? undefined,
      identifier: meta.appleId,
      isrc: meta.isrc,
      sourceName: meta.source as SourceName,
      isSeekable: true,
      isStream: false,
    },
    pluginInfo: {},
    requester: requester as UnresolvedTrack["requester"],
    userData: { apple: meta },
    // Several callers (prefetch, play(), queue end) may ask at once, so share one run.
    resolve(player: Player) {
      pending ??= (async () => {
        const final = await resolveToTrack(player, meta, requester);
        const self = this as unknown as Record<string | symbol, unknown>;
        for (const key of Object.keys(self)) delete self[key];
        Object.assign(self, final);
      })();
      return pending;
    },
  };
  return entry;
}

/** Wrap every Apple track in a search result; leave other sources unchanged. */
export function wrapAppleTracks(tracks: (Track | UnresolvedTrack)[]): (Track | UnresolvedTrack)[] {
  return tracks.map((t) => (isAppleTrack(t) ? createAppleTrack(appleMetaFromTrack(t), t.requester) : t));
}

/** Start resolving the next queued track so it's ready when the current one ends. */
export function prefetchNext(player: Player): void {
  const next = player.queue.tracks[0];
  if (!next || !("resolve" in next) || typeof next.resolve !== "function") return;
  next.resolve(player).catch((error: unknown) => logger.debug({ err: error }, "Prefetch failed"));
}

async function resolveToTrack(player: Player, meta: AppleMeta, requester: unknown): Promise<Track> {
  let resolved: Resolved | null = null;
  try {
    resolved = await findMatch(player, meta, requester);
  } catch (error) {
    logger.warn({ err: error, track: label(meta) }, "Matching failed, falling back to LavaSrc");
  }

  if (!resolved) {
    logger.info({ track: label(meta) }, "No confident match, letting LavaSrc resolve it");
    const userData: MatchUserData = {
      apple: meta,
      match: { method: "lavasrc", videoId: null, ytTitle: null, ytAuthor: null, score: null },
    };
    return {
      encoded: meta.encoded,
      info: {
        identifier: meta.appleId,
        title: meta.title,
        author: meta.artist,
        duration: meta.durationMs,
        artworkUrl: meta.artworkUrl,
        uri: meta.uri ?? "",
        sourceName: meta.source as SourceName,
        isSeekable: true,
        isStream: false,
        isrc: meta.isrc,
      },
      pluginInfo: {},
      requester: requester as Track["requester"],
      userData: userData as unknown as Track["userData"],
    };
  }

  const yt = resolved.track;
  const userData: MatchUserData = { apple: meta, match: resolved.info };
  return {
    encoded: yt.encoded,
    info: {
      ...yt.info,
      // Show Apple's metadata; keep YouTube's duration so the progress bar is right.
      title: meta.title,
      author: meta.artist,
      artworkUrl: meta.artworkUrl ?? yt.info.artworkUrl,
      uri: meta.uri ?? yt.info.uri,
      isrc: meta.isrc ?? yt.info.isrc,
    },
    pluginInfo: yt.pluginInfo ?? {},
    requester: requester as Track["requester"],
    userData: userData as unknown as Track["userData"],
  };
}

// ---------- matching ----------

async function findMatch(player: Player, meta: AppleMeta, requester: unknown): Promise<Resolved | null> {
  const { cfg, cache, deezerEnabled } = getState();
  const keys = matchKeys(meta);
  const banned = cache.blacklisted(keys);
  const source = toSource(meta);

  // 1. Cache
  const cached = cache.get(keys);
  if (cached) {
    const track = await player.node.decode.singleTrack(cached.encoded, requester).catch(() => null);
    if (track?.encoded) {
      logger.debug({ track: label(meta), videoId: cached.videoId }, "Match from cache");
      return { track, info: info("cache", track, cached.score) };
    }
    cache.delete(keys); // undecodable (e.g. plugin format change), match again
  }

  const remember = (method: MatchMethod, track: Track, score: number | null): Resolved => {
    const result = { track, info: info(method, track, score) };
    const key = keys[0];
    if (key && track.encoded) {
      cache.set({
        key,
        videoId: track.info.identifier,
        encoded: track.encoded,
        title: track.info.title,
        author: track.info.author,
        durationMs: track.info.duration,
        score,
        method,
      });
    }
    logger.info(
      { track: label(meta), videoId: track.info.identifier, method, score },
      `Matched → "${truncate(track.info.title, 80)}" by ${track.info.author}`,
    );
    return result;
  };

  // 2. ISRC
  if (cfg.isrc.enabled && meta.isrc) {
    if (deezerEnabled) {
      const dz = await search(player, meta.isrc, "dzisrc", requester);
      const hit = dz.find((t) => !banned.has(t.info.identifier));
      if (hit) return remember("isrc-deezer", hit, null);
    }

    const yt = await search(player, `"${meta.isrc}"`, "ytmsearch", requester);
    // ISRC search results are only trusted at the top; check the first few.
    for (const track of yt.slice(0, 3)) {
      if (banned.has(track.info.identifier) || track.info.isStream) continue;
      if (!cfg.isrc.verify) return remember("isrc-youtube", track, null);
      const b = scoreCandidate(source, toCandidate(track), cfg);
      logDebug(`ISRC check ${label(meta)}`, [{ candidate: toCandidate(track), breakdown: b, score: b.total }]);
      if (b.total >= cfg.isrc.minScore) return remember("isrc-youtube", track, b.total);
    }
  }

  // 3. Text search + scoring (+ rerank)
  // "<artist> <title>", using the main artist only: long credit lists make YouTube search worse.
  const query = searchQuery(meta);
  for (const platform of cfg.search.sources) {
    const results = await search(player, query, platform, requester);
    const candidates = results
      .filter((t) => !t.info.isStream && !banned.has(t.info.identifier))
      .slice(0, cfg.search.maxCandidates)
      .map(toCandidate);
    if (candidates.length === 0) continue;

    let ranked: ScoredCandidate<CandidateWithTrack>[] = rankCandidates(source, candidates, cfg);

    if (cfg.rerank.enabled) {
      const pool = rerankPool(ranked, cfg.rerank.margin);
      if (pool.length > 1) {
        const cosines = await cosineSimilarities(
          sourceEmbeddingText(source),
          pool.map((p) => p.candidate.title),
        );
        if (cosines) ranked = applyRerank(ranked, pool, cosines, cfg.rerank.weight);
        else logger.debug({ track: label(meta) }, "Near-tie, but the embedding model isn't ready; skipping rerank");
      }
    }

    logDebug(`${platform} "${query}"`, ranked);

    const top = ranked[0];
    if (top && top.score >= cfg.search.minAcceptScore) {
      return remember("search", top.candidate.track, top.embedding?.combined ?? top.score);
    }
    logger.debug(
      { track: label(meta), platform, best: top?.score, threshold: cfg.search.minAcceptScore },
      "No candidate reached minAcceptScore",
    );
  }

  return null;
}

async function search(player: Player, query: string, source: string, requester: unknown): Promise<Track[]> {
  try {
    const res = await player.search({ query, source: source as SearchPlatform }, requester);
    if (res.loadType === "error" || res.loadType === "empty") return [];
    return res.tracks.filter((t): t is Track => typeof t.encoded === "string");
  } catch (error) {
    logger.debug({ err: error, query, source }, "Search request failed");
    return [];
  }
}

function info(method: MatchMethod, track: Track, score: number | null): MatchInfo {
  return {
    method,
    videoId: track.info.identifier,
    ytTitle: track.info.title,
    ytAuthor: track.info.author,
    score: score === null ? null : Math.round(score * 10) / 10,
  };
}

function logDebug(title: string, ranked: ScoredCandidate[]): void {
  if (!logger.isLevelEnabled("debug")) return;
  logger.debug(`Score breakdown for ${title}:\n${ranked.map(formatBreakdown).join("\n")}`);
}

// ---------- /wrong ----------

export interface WrongResult {
  blacklisted: string;
  replacement: Track;
}

/**
 * Blacklist the current match for this song, clear its cache entry, and build a freshly matched
 * replacement (which can't pick the blacklisted video again).
 */
export async function rematchAfterWrong(player: Player, track: Track): Promise<WrongResult | null> {
  const { cache } = getState();
  const data = getMatchData(track);
  const videoId = data?.match?.videoId;
  if (!data || !videoId) return null;

  const keys = matchKeys(data.apple);
  cache.blacklist(keys, videoId);
  cache.delete(keys);
  logger.info({ track: label(data.apple), videoId }, "Match marked wrong and blacklisted");

  const replacement = createAppleTrack(data.apple, track.requester);
  await replacement.resolve(player);
  return { blacklisted: videoId, replacement: replacement as unknown as Track };
}

/** Fresh unresolved copy of an Apple track, e.g. to replace stale copies in the queue. */
export function freshCopy(track: Track | UnresolvedTrack): UnresolvedTrack | null {
  const data = getMatchData(track);
  return data ? createAppleTrack(data.apple, track.requester) : null;
}
