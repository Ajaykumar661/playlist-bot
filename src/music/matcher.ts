/**
 * Pure scoring logic for matching an Apple Music track to a YouTube candidate.
 * No I/O here, so it's easy to unit test. See test/matcher.test.ts.
 * Weights and thresholds come from config/matching.json.
 */
import { token_set_ratio } from "fuzzball";
import type { MatchingConfig } from "./matchingConfig.js";

export interface SourceTrack {
  title: string;
  artist: string;
  album?: string | null;
  durationMs?: number | null;
  isrc?: string | null;
}

export interface Candidate {
  /** YouTube video id (Lavalink track identifier). */
  id: string;
  title: string;
  author: string;
  durationMs: number;
}

export interface ScoreBreakdown {
  titleSimilarity: number; // 0..1
  artistSimilarity: number; // 0..1
  title: number;
  artist: number;
  topicChannel: number;
  duration: number;
  durationDiffSec: number | null;
  officialAudio: number;
  penalties: Record<string, number>;
  total: number;
}

export interface ScoredCandidate<C extends Candidate = Candidate> {
  candidate: C;
  score: number;
  breakdown: ScoreBreakdown;
  /** Set when the embedding rerank ran on this candidate. */
  embedding?: { cosine: number; combined: number };
}

// ---------- normalisation ----------

/**
 * Lowercase, fold compatibility forms, turn punctuation into spaces, collapse whitespace.
 * Keeps letters (\p{L}), combining marks (\p{M}, needed for Tamil/Hindi vowel signs) and digits.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’‘`´]/g, "") // "don't" → "dont" rather than "don t"
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const FEAT_RE = /[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]|\s(?:feat\.?|ft\.?|featuring)\s.*$/giu;
const FROM_RE = /[([]\s*from\s+["“”']?([^"“”')\]]+)["“”']?\s*[)\]]/giu;
const SUFFIX_RE = /\s-\s(?:single|ep)$/iu;
const REMASTER_RE = /[([]?\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*[)\]]?/giu;

/** Clean an Apple Music title for comparison: drop "feat. X", keep the film name from '(From "Film")'. */
export function cleanSourceTitle(title: string): string {
  const cleaned = title
    .replace(FEAT_RE, " ")
    .replace(FROM_RE, " $1 ")
    .replace(SUFFIX_RE, " ")
    .replace(REMASTER_RE, " ");
  return normalize(cleaned);
}

/** The song name alone, without the film name: 'Kaavaalaa (From "Jailer")' → "kaavaalaa". */
export function coreSourceTitle(title: string): string {
  const cleaned = title
    .replace(FEAT_RE, " ")
    .replace(FROM_RE, " ")
    .replace(SUFFIX_RE, " ")
    .replace(REMASTER_RE, " ");
  return normalize(cleaned) || cleanSourceTitle(title);
}

/** Words on YouTube titles that say nothing about which song it is. */
const CANDIDATE_NOISE = [
  "official music video",
  "official video",
  "official audio",
  "official lyric video",
  "official lyrics video",
  "music video",
  "lyric video",
  "lyrical video",
  "video song",
  "audio song",
  "full video song",
  "full song",
  "full audio",
  "visualizer",
  "visualiser",
  "official",
  "video",
  "audio",
  "lyrics",
  "lyric",
  "lyrical",
  "hd",
  "4k",
  "hq",
  "mv",
  "from",
  "feat",
  "ft",
  "featuring",
];
const NOISE_RE = new RegExp(`(?:^|\\s)(?:${CANDIDATE_NOISE.map(escapeRegExp).join("|")})(?=\\s|$)`, "gu");

/** Strip YouTube noise words from an already-normalized candidate title. */
export function cleanCandidateTitle(title: string): string {
  let text = normalize(title);
  // Run twice so adjacent noise words ("official video") are removed even after a shorter match.
  for (let i = 0; i < 2; i++) text = ` ${text} `.replace(NOISE_RE, " ").trim().replace(/\s+/g, " ");
  return text;
}

const TOPIC_RE = /\s*-\s*topic$/iu;

/** "Anirudh Ravichander - Topic" → "anirudh ravichander"; "EdSheeranVEVO" → "edsheeran". */
export function cleanChannelName(author: string): string {
  return normalize(author.replace(TOPIC_RE, "").replace(/vevo$/iu, "").replace(/\bofficial\b/giu, ""));
}

export function isTopicChannel(author: string): boolean {
  return TOPIC_RE.test(author.trim());
}

/** "A, B & C feat. D" → ["a", "b", "c", "d"] (normalized). */
export function splitArtists(artist: string): string[] {
  return artist
    .split(/\s*(?:,|&|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\/|;)\s*/iu)
    .map(normalize)
    .filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  return ` ${haystack} `.includes(` ${p} `);
}

/** Fuzzy similarity on our own normalized strings (fuzzball's processing would strip Tamil vowel signs). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return token_set_ratio(a, b, { full_process: false }) / 100;
}

// ---------- scoring ----------

export function artistSimilarity(source: SourceTrack, candidate: Candidate): number {
  const artists = splitArtists(source.artist);
  const full = normalize(source.artist);
  const channel = cleanChannelName(candidate.author);
  const title = normalize(candidate.title);
  if (artists.length === 0) return 0;

  const primary = artists[0]!;
  let best = Math.max(similarity(full, channel), similarity(primary, channel));
  for (const a of artists.slice(1)) best = Math.max(best, similarity(a, channel) * 0.9);

  // Label channels (T-Series, Sony Music South…) usually put the artist in the title instead.
  if (containsPhrase(title, primary)) best = Math.max(best, 0.95);
  else if (artists.slice(1).some((a) => containsPhrase(title, a))) best = Math.max(best, 0.8);
  else {
    // Partial credit for a shortened name in the title ("Anirudh" for "Anirudh Ravichander").
    const titleTokens = new Set(title.split(" "));
    const primaryTokens = primary.split(" ").filter((t) => t.length > 1);
    const present = primaryTokens.filter((t) => titleTokens.has(t)).length;
    if (primaryTokens.length > 0 && present / primaryTokens.length >= 0.5) {
      best = Math.max(best, 0.9 * (present / primaryTokens.length));
    }
  }
  return best;
}

export function scoreCandidate(source: SourceTrack, candidate: Candidate, cfg: MatchingConfig): ScoreBreakdown {
  const w = cfg.weights;
  const sourceTitle = cleanSourceTitle(source.title);
  const sourceCore = coreSourceTitle(source.title);
  const candTitle = cleanCandidateTitle(candidate.title);

  // Title: compare against the cleaned title, and against it with the artist names removed,
  // since "Artist - Title" uploads would otherwise get extra unmatched tokens.
  let candWithoutArtists = candTitle;
  for (const a of splitArtists(source.artist)) candWithoutArtists = ` ${candWithoutArtists} `.replace(` ${a} `, " ").trim();
  const titleSim = (t: string) => Math.max(similarity(t, candTitle), similarity(t, candWithoutArtists));
  // When the title names a film, a different song from the same film shares that word,
  // so most of the weight goes to the song name alone (weights.coreTitleShare).
  const titleSimilarity =
    sourceCore === sourceTitle
      ? titleSim(sourceTitle)
      : w.coreTitleShare * titleSim(sourceCore) + (1 - w.coreTitleShare) * titleSim(sourceTitle);

  const artistSim = artistSimilarity(source, candidate);
  const topic =
    isTopicChannel(candidate.author) && artistSim >= w.topicChannelMinArtistSimilarity ? w.topicChannelBonus : 0;

  // Duration
  let durationPoints = 0;
  let durationDiffSec: number | null = null;
  if (source.durationMs && source.durationMs > 0 && candidate.durationMs > 0) {
    durationDiffSec = Math.abs(source.durationMs - candidate.durationMs) / 1000;
    if (durationDiffSec <= cfg.duration.boostWithinSec) durationPoints = cfg.duration.boost;
    else if (durationDiffSec > cfg.duration.penaltyBeyondSec) durationPoints = -cfg.duration.penalty;
  }

  // Variant penalties: look in the raw candidate title and channel, allow if the Apple title/album has it too.
  const candRaw = normalize(`${candidate.title} ${candidate.author}`);
  const sourceContext = normalize(`${source.title} ${source.album ?? ""}`);
  const penalties: Record<string, number> = {};
  for (const group of cfg.variants) {
    const hit = group.patterns.some((p) => containsPhrase(candRaw, p));
    if (!hit) continue;
    const allowed = group.patterns.some((p) => containsPhrase(sourceContext, p));
    if (!allowed) penalties[group.name] = group.penalty;
  }

  const officialAudio = cfg.officialAudioPatterns.some((p) => containsPhrase(normalize(candidate.title), p))
    ? w.officialAudioBonus
    : 0;

  const title = w.title * titleSimilarity;
  const artist = w.artist * artistSim;
  const penaltyTotal = Object.values(penalties).reduce((a, b) => a + b, 0);
  const total = round(title + artist + topic + durationPoints + officialAudio - penaltyTotal);

  return {
    titleSimilarity: round(titleSimilarity, 3),
    artistSimilarity: round(artistSim, 3),
    title: round(title),
    artist: round(artist),
    topicChannel: topic,
    duration: durationPoints,
    durationDiffSec: durationDiffSec === null ? null : round(durationDiffSec, 1),
    officialAudio,
    penalties,
    total,
  };
}

/** Score and sort candidates, best first. Ties keep the original (search) order. */
export function rankCandidates<C extends Candidate>(
  source: SourceTrack,
  candidates: C[],
  cfg: MatchingConfig,
): ScoredCandidate<C>[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, breakdown: scoreCandidate(source, candidate, cfg) }))
    .sort((a, b) => b.breakdown.total - a.breakdown.total || a.index - b.index)
    .map(({ candidate, breakdown }) => ({ candidate, breakdown, score: breakdown.total }));
}

/** Candidates close enough to the leader that the embedding rerank should decide between them. */
export function rerankPool<C extends Candidate>(ranked: ScoredCandidate<C>[], margin: number): ScoredCandidate<C>[] {
  if (ranked.length < 2) return [];
  const top = ranked[0]!.score;
  if (top - ranked[1]!.score > margin) return [];
  return ranked.filter((r) => top - r.score <= margin);
}

/**
 * Apply embedding similarities to the pool and return the full ranking with the pool reordered.
 * `cosines[i]` belongs to `pool[i]`.
 */
export function applyRerank<C extends Candidate>(
  ranked: ScoredCandidate<C>[],
  pool: ScoredCandidate<C>[],
  cosines: number[],
  weight: number,
): ScoredCandidate<C>[] {
  const reranked = pool
    .map((entry, i) => {
      const cosine = cosines[i] ?? 0;
      return { ...entry, embedding: { cosine: round(cosine, 3), combined: round(entry.score + weight * cosine) } };
    })
    .sort((a, b) => b.embedding.combined - a.embedding.combined);
  const poolIds = new Set(pool.map((p) => p.candidate.id));
  return [...reranked, ...ranked.filter((r) => !poolIds.has(r.candidate.id))];
}

/** Text used for the embedding of the Apple track. */
export function sourceEmbeddingText(source: SourceTrack): string {
  return `${source.artist} - ${source.title}`;
}

/** One-line breakdown for debug logs. */
export function formatBreakdown(entry: ScoredCandidate): string {
  const b = entry.breakdown;
  const pens = Object.entries(b.penalties)
    .map(([k, v]) => `-${v} ${k}`)
    .join(" ");
  const emb = entry.embedding ? ` | emb cos=${entry.embedding.cosine} → ${entry.embedding.combined}` : "";
  return (
    `${b.total.toFixed(1).padStart(6)} = title ${b.title} (${b.titleSimilarity}) + artist ${b.artist} (${b.artistSimilarity})` +
    ` + topic ${b.topicChannel} + dur ${b.duration} (Δ${b.durationDiffSec ?? "?"}s) + official ${b.officialAudio}` +
    (pens ? ` ${pens}` : "") +
    emb +
    ` :: [${entry.candidate.id}] "${entry.candidate.title}" by ${entry.candidate.author}`
  );
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
