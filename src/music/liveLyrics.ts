/**
 * Rolling lyrics: one message per server that shows the line being sung, with the lines around it,
 * and updates as the song plays. Opt-in per song (🎤 button or /lyrics): it ends when that song ends,
 * when the bot leaves, when the message is deleted, or when someone presses Stop.
 *
 * The message is only edited when the current line changes, and at most every EDIT_GAP_MS,
 * which keeps well inside Discord's rate limits.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import type { Player, Track } from "lavalink-client";
import { Colors, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../utils/types.js";
import { currentLineIndex, findLyricsForTrack, parseLrc, type LyricLine } from "./lyrics.js";

export const LYRICS_PREFIX = "lyrics:";
export const isLyricsButton = (customId: string) => customId.startsWith(LYRICS_PREFIX);

const TICK_MS = 500;
const EDIT_GAP_MS = 1_500;
/** Show a line slightly early: the edit takes a moment to reach Discord. */
const LEAD_MS = 400;
const MAX_SESSION_MS = 6 * 60 * 60_000;
const LINES_BEFORE = 2;
const LINES_AFTER = 3;

type TrackLyrics = { lines: LyricLine[]; source: string } | { lines: null; reason: string };

interface Session {
  guildId: string;
  message: Message;
  timer: NodeJS.Timeout;
  startedAt: number;
  trackKey: string | null;
  lyrics: TrackLyrics | null; // null while loading
  shown: string; // what the message shows now, to skip edits that change nothing
  lastEdit: number;
  editing: boolean;
}
const sessions = new Map<string, Session>();

const trackKey = (track: Track) => track.encoded ?? track.info.identifier;

async function loadLyrics(track: Track): Promise<TrackLyrics> {
  try {
    const found = await findLyricsForTrack(track, true);
    if (found?.instrumental) return { lines: null, reason: "🎼 This song is instrumental." };
    if (!found?.syncedLyrics) return { lines: null, reason: "No synced lyrics for this song. `/lyrics mode:Full` shows the plain lyrics." };
    const lines = parseLrc(found.syncedLyrics);
    return lines.length
      ? { lines, source: `${found.trackName} — ${found.artistName}` }
      : { lines: null, reason: "No synced lyrics for this song." };
  } catch (error) {
    logger.warn({ err: error }, "Live lyrics lookup failed");
    return { lines: null, reason: "The lyrics service didn't respond." };
  }
}

function controls(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${LYRICS_PREFIX}full`).setEmoji("📄").setLabel("Full lyrics").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${LYRICS_PREFIX}stop`).setEmoji("⏹️").setLabel("Stop live lyrics").setStyle(ButtonStyle.Danger),
  );
}

/** The visible part: a couple of lines before (small), the current line (big), a few after. */
export function renderLines(lines: LyricLine[], index: number): string {
  const show = (l: LyricLine | undefined) => escapeMd(l?.text || "♪");
  const out: string[] = [];
  for (let i = Math.max(0, index - LINES_BEFORE); i < index; i++) out.push(`-# ${show(lines[i])}`);
  out.push(index < 0 ? "### 🎵 …" : `### ${show(lines[index])}`);
  for (let i = index + 1; i <= index + LINES_AFTER && i < lines.length; i++) out.push(show(lines[i]));
  return out.join("\n");
}

function render(player: Player, track: Track, lyrics: TrackLyrics | null): { key: string; embed: EmbedBuilder } {
  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setAuthor({ name: "🎤 Live lyrics" })
    .setTitle(truncate(`${track.info.title} — ${track.info.author}`, 250));
  if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

  if (!lyrics) return { key: `loading:${trackKey(track)}`, embed: embed.setDescription("*Looking up lyrics…*") };
  if (!lyrics.lines) return { key: `none:${trackKey(track)}`, embed: embed.setDescription(lyrics.reason) };

  const index = currentLineIndex(lyrics.lines, player.position + LEAD_MS);
  const paused = player.paused ? " · ⏸️ paused" : "";
  embed
    .setDescription(renderLines(lyrics.lines, index))
    .setFooter({
      text: truncate(`${formatDuration(player.position)} / ${formatDuration(track.info.duration)}${paused} · ${lyrics.source} · LRCLIB`, 2000),
    });
  // Re-render when the line changes or playback is paused/resumed, not for every second of the clock.
  return { key: `${trackKey(track)}:${index}:${player.paused}`, embed };
}

async function tick(client: BotClient, session: Session): Promise<void> {
  if (session.editing) return;
  const player = client.lavalink.getPlayer(session.guildId);
  if (!player) return void stopSession(session, "⏹️ Playback stopped, so live lyrics ended.");
  if (Date.now() - session.startedAt > MAX_SESSION_MS) return void stopSession(session, "Live lyrics ended. Run `/lyrics` again to restart.");

  const track = player.queue.current;
  if (!track) return;

  // Lyrics are opt-in per song: when the song changes, this session ends.
  const key = trackKey(track);
  if (session.trackKey !== null && key !== session.trackKey) {
    return void stopSession(session, "🎤 That song finished. Press **🎤 Lyrics** on the Now playing message (or `/lyrics`) for this one.");
  }
  // First tick: look up the lyrics (the message shows "Looking up lyrics…" meanwhile).
  if (session.trackKey === null) {
    session.trackKey = key;
    session.lyrics = null;
    void loadLyrics(track).then((lyrics) => {
      if (session.trackKey === key) session.lyrics = lyrics;
    });
  }

  const view = render(player, track, session.lyrics);
  if (view.key === session.shown || Date.now() - session.lastEdit < EDIT_GAP_MS) return;

  session.editing = true;
  try {
    await session.message.edit({ embeds: [view.embed], components: [controls()] });
    session.shown = view.key;
    session.lastEdit = Date.now();
  } catch (error) {
    // Usually the message was deleted: stop quietly.
    logger.debug({ err: error }, "Live lyrics edit failed, stopping");
    stopSession(session);
  } finally {
    session.editing = false;
  }
}

function stopSession(session: Session, finalText?: string): void {
  clearInterval(session.timer);
  if (sessions.get(session.guildId) === session) sessions.delete(session.guildId);
  if (finalText) void session.message.edit({ embeds: [infoEmbed(finalText)], components: [] }).catch(() => undefined);
}

/** Start rolling lyrics in `message` (the bot's own message). Replaces any other live lyrics in the server. */
export function startLiveLyrics(client: BotClient, guildId: string, message: Message): void {
  const old = sessions.get(guildId);
  if (old) stopSession(old, "Live lyrics moved to a newer message ⬇️");
  const session: Session = {
    guildId,
    message,
    timer: setInterval(() => void tick(client, session), TICK_MS),
    startedAt: Date.now(),
    trackKey: null,
    lyrics: null,
    shown: "",
    lastEdit: 0,
    editing: false,
  };
  session.timer.unref();
  sessions.set(guildId, session);
  void tick(client, session);
}

export function stopLiveLyrics(guildId: string): void {
  const session = sessions.get(guildId);
  if (session) stopSession(session, "⏹️ Live lyrics stopped.");
}

export async function handleLyricsButton(interaction: ButtonInteraction<"cached">, client: BotClient): Promise<void> {
  const action = interaction.customId.slice(LYRICS_PREFIX.length);
  const session = sessions.get(interaction.guildId);

  if (action === "stop") {
    if (session?.message.id === interaction.message.id) {
      clearInterval(session.timer);
      sessions.delete(interaction.guildId);
    }
    await interaction.update({ embeds: [infoEmbed(`⏹️ Live lyrics stopped by <@${interaction.user.id}>.`)], components: [], allowedMentions: { parse: [] } });
    return;
  }

  // "Full lyrics": the whole text, only for the person who asked.
  const track = client.lavalink.getPlayer(interaction.guildId)?.queue.current;
  if (!track) return void (await interaction.reply({ embeds: [errorEmbed("Nothing is playing.")], flags: MessageFlags.Ephemeral }));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const found = await findLyricsForTrack(track).catch(() => null);
  const text = found?.plainLyrics?.trim() ?? (found?.syncedLyrics ? parseLrc(found.syncedLyrics).map((l) => l.text).join("\n") : "");
  await interaction.editReply({
    embeds: [
      text
        ? new EmbedBuilder().setColor(Colors.primary).setTitle(truncate(`${track.info.title} — ${track.info.author}`, 250)).setDescription(truncate(text, 4000))
        : errorEmbed("No lyrics found for this song."),
    ],
  });
}
