import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface VariantGroup {
  name: string;
  patterns: string[];
  penalty: number;
}

export interface MatchingConfig {
  isrc: { enabled: boolean; verify: boolean; minScore: number };
  search: { sources: string[]; maxCandidates: number; minAcceptScore: number };
  weights: {
    title: number;
    coreTitleShare: number;
    artist: number;
    topicChannelBonus: number;
    topicChannelMinArtistSimilarity: number;
    officialAudioBonus: number;
  };
  duration: { boostWithinSec: number; boost: number; penaltyBeyondSec: number; penalty: number };
  officialAudioPatterns: string[];
  variants: VariantGroup[];
  rerank: { enabled: boolean; margin: number; weight: number; model: string; dtype: string; cacheDir: string };
  cache: { enabled: boolean; path: string; maxAgeDays: number };
}

/** Default location: <project>/config/matching.json. Override with MATCHING_CONFIG=/path/to/file.json */
export function matchingConfigPath(): string {
  return resolve(process.env.MATCHING_CONFIG?.trim() || "config/matching.json");
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid matching config (${matchingConfigPath()}): "${path}" ${message}`);
}

function num(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${key}`, "must be a number");
  return v;
}
function bool(obj: Record<string, unknown>, key: string, path: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") fail(`${path}.${key}`, "must be true or false");
  return v;
}
function str(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== "string" || !v) fail(`${path}.${key}`, "must be a non-empty string");
  return v;
}
function strArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) fail(path, "must be an array of strings");
  return v;
}
function section(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = root[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(key, "must be an object");
  return v as Record<string, unknown>;
}

/** Parse and validate a config object (exported for tests). */
export function parseMatchingConfig(raw: unknown): MatchingConfig {
  if (!raw || typeof raw !== "object") fail("<root>", "must be a JSON object");
  const root = raw as Record<string, unknown>;
  const isrc = section(root, "isrc");
  const search = section(root, "search");
  const weights = section(root, "weights");
  const duration = section(root, "duration");
  const rerank = section(root, "rerank");
  const cache = section(root, "cache");

  if (!Array.isArray(root.variants)) fail("variants", "must be an array");
  const variants = (root.variants as unknown[]).map((g, i) => {
    if (!g || typeof g !== "object") fail(`variants[${i}]`, "must be an object");
    const group = g as Record<string, unknown>;
    return {
      name: str(group, "name", `variants[${i}]`),
      patterns: strArray(group.patterns, `variants[${i}].patterns`),
      penalty: num(group, "penalty", `variants[${i}]`),
    };
  });

  const sources = strArray(search.sources, "search.sources");
  if (sources.length === 0) fail("search.sources", "needs at least one source");

  return {
    isrc: { enabled: bool(isrc, "enabled", "isrc"), verify: bool(isrc, "verify", "isrc"), minScore: num(isrc, "minScore", "isrc") },
    search: {
      sources,
      maxCandidates: Math.max(1, Math.round(num(search, "maxCandidates", "search"))),
      minAcceptScore: num(search, "minAcceptScore", "search"),
    },
    weights: {
      title: num(weights, "title", "weights"),
      coreTitleShare: Math.min(1, Math.max(0, num(weights, "coreTitleShare", "weights"))),
      artist: num(weights, "artist", "weights"),
      topicChannelBonus: num(weights, "topicChannelBonus", "weights"),
      topicChannelMinArtistSimilarity: num(weights, "topicChannelMinArtistSimilarity", "weights"),
      officialAudioBonus: num(weights, "officialAudioBonus", "weights"),
    },
    duration: {
      boostWithinSec: num(duration, "boostWithinSec", "duration"),
      boost: num(duration, "boost", "duration"),
      penaltyBeyondSec: num(duration, "penaltyBeyondSec", "duration"),
      penalty: num(duration, "penalty", "duration"),
    },
    officialAudioPatterns: strArray(root.officialAudioPatterns, "officialAudioPatterns"),
    variants,
    rerank: {
      enabled: bool(rerank, "enabled", "rerank"),
      margin: num(rerank, "margin", "rerank"),
      weight: num(rerank, "weight", "rerank"),
      model: str(rerank, "model", "rerank"),
      dtype: str(rerank, "dtype", "rerank"),
      cacheDir: str(rerank, "cacheDir", "rerank"),
    },
    cache: {
      enabled: bool(cache, "enabled", "cache"),
      path: str(cache, "path", "cache"),
      maxAgeDays: num(cache, "maxAgeDays", "cache"),
    },
  };
}

let cached: MatchingConfig | null = null;

export function loadMatchingConfig(): MatchingConfig {
  if (cached) return cached;
  const path = matchingConfigPath();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Matching config not found at ${path}. It ships as config/matching.json in the repo.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Matching config ${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  cached = parseMatchingConfig(json);
  return cached;
}
