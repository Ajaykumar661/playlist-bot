import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getMatchData } from "../music/trackResolver.js";
import { Colors, errorEmbed, respond } from "../utils/embeds.js";
import { truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { Command } from "../utils/types.js";

// LRCLIB: free, no API key, good coverage including Indian film songs. https://lrclib.net/docs
const API = "https://lrclib.net/api";
const HEADERS = { "User-Agent": "apple-music-discord-bot/1.0 (self-hosted Discord bot)" };
const PAGE = 3900;

interface LrclibTrack {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB returned ${res.status}`);
  return (await res.json()) as T;
}

async function findLyrics(title: string, artist: string | null, durationSec: number | null): Promise<LrclibTrack | null> {
  if (artist) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (durationSec) params.set("duration", String(Math.round(durationSec)));
    const exact = await fetchJson<LrclibTrack>(`${API}/get?${params.toString()}`);
    if (exact?.plainLyrics || exact?.instrumental) return exact;
  }
  const results = await fetchJson<LrclibTrack[]>(`${API}/search?${new URLSearchParams({ q: [artist, title].filter(Boolean).join(" ") }).toString()}`);
  return results?.find((r) => r.plainLyrics) ?? null;
}

export const lyrics: Command = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Show lyrics for the current song, or search for any song")
    .addStringOption((o) => o.setName("song").setDescription("Song to look up (default: what's playing)").setMaxLength(200)),

  async execute(interaction, client) {
    const query = interaction.options.getString("song");
    const current = client.lavalink.getPlayer(interaction.guildId)?.queue.current;
    if (!query && !current) {
      await respond(interaction, errorEmbed("Nothing is playing. Use `/lyrics song:<name>` to look one up."), true);
      return;
    }
    await interaction.deferReply();

    // Prefer the Apple/Spotify metadata over YouTube's noisy titles.
    const meta = current ? getMatchData(current)?.apple : null;
    const title = query ?? meta?.title ?? current!.info.title;
    const artist = query ? null : (meta?.artist ?? current!.info.author);
    const durationSec = query ? null : (meta?.durationMs ?? current!.info.duration) / 1000;
    const cleanTitle = title.replace(/\s*[([](?:feat|ft|from|with)[^)\]]*[)\]]/gi, "").trim();

    let found: LrclibTrack | null;
    try {
      found = await findLyrics(cleanTitle, artist?.split(/,|&/)[0]?.trim() ?? null, durationSec);
    } catch (error) {
      logger.warn({ err: error, title }, "Lyrics lookup failed");
      await respond(interaction, errorEmbed("The lyrics service didn't respond. Try again in a moment."));
      return;
    }

    if (!found) {
      await respond(interaction, errorEmbed(`No lyrics found for **${truncate(title, 100)}**.`));
      return;
    }
    const text = found.instrumental ? "🎼 *Instrumental*" : (found.plainLyrics ?? "").trim();
    const pages: string[] = [];
    for (let i = 0; i < text.length && pages.length < 3; i += PAGE) pages.push(text.slice(i, i + PAGE));
    const embeds = pages.map((page, i) =>
      new EmbedBuilder()
        .setColor(Colors.primary)
        .setDescription(page + (i === pages.length - 1 && text.length > PAGE * 3 ? "\n…" : "")),
    );
    embeds[0]!.setTitle(truncate(`${found.trackName} — ${found.artistName}`, 250));
    embeds[embeds.length - 1]!.setFooter({ text: "Lyrics from LRCLIB" });
    await interaction.editReply({ embeds });
  },
};
