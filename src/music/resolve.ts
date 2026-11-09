/**
 * Classify what the user passed to /play before we send it to Lavalink.
 */
export type QueryKind =
  | { kind: "apple-library" } // private library link, can't be read
  | { kind: "apple"; url: string; type: "playlist" | "album" | "track" | "artist" | "other" }
  | { kind: "url"; url: string } // some other link (YouTube, SoundCloud…)
  | { kind: "search"; text: string };

const APPLE_HOSTS = new Set(["music.apple.com", "itunes.apple.com", "geo.music.apple.com", "embed.music.apple.com"]);

export function classifyQuery(input: string): QueryKind {
  const trimmed = input.trim();

  let url: URL | null;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }

  if (!url || !/^https?:$/.test(url.protocol)) {
    return { kind: "search", text: trimmed };
  }

  if (!APPLE_HOSTS.has(url.hostname.toLowerCase())) {
    return { kind: "url", url: url.toString() };
  }

  // Path looks like /{country}/playlist/{name}/{id}, /library/playlist/p.xxxx, etc.
  const segments = url.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
  if (segments.includes("library") || segments.some((s) => s.startsWith("p.") && !s.startsWith("pl."))) {
    return { kind: "apple-library" };
  }

  // Normalise embed/geo hosts to music.apple.com so LavaSrc's URL pattern matches.
  url.hostname = "music.apple.com";

  // Album link with ?i=<trackId> points at one song.
  if (segments.includes("album") && url.searchParams.has("i")) return { kind: "apple", url: url.toString(), type: "track" };
  if (segments.includes("playlist")) return { kind: "apple", url: url.toString(), type: "playlist" };
  if (segments.includes("album")) return { kind: "apple", url: url.toString(), type: "album" };
  if (segments.includes("song")) return { kind: "apple", url: url.toString(), type: "track" };
  if (segments.includes("artist")) return { kind: "apple", url: url.toString(), type: "artist" };
  return { kind: "apple", url: url.toString(), type: "other" };
}
