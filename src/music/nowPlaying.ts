/**
 * The "Now playing" message with control buttons.
 * One live message per guild: a new track replaces it, and the old one loses its buttons.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Player, Track, UnresolvedTrack } from "lavalink-client";
import { Colors } from "../utils/embeds.js";
import { escapeMd, timingLine, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { BotClient, Requester } from "../utils/types.js";
import { sendToPlayerChannel } from "./notify.js";
import { getMatchData } from "./trackResolver.js";
import { buildQueueEmbed, clampPage, queueComponents } from "./queueView.js";

export const CONTROL_PREFIX = "player:";
export type ControlId =
  | "previous"
  | "pause"
  | "skip"
  | "stop"
  | "queue"
  | "shuffle"
  | "loop"
  | "autoplay"
  | "lyrics";

const METHOD_LABEL = {
  cache: "cached match",
  "isrc-deezer": "Deezer ISRC",
  "isrc-youtube": "ISRC",
  search: "search",
  lavasrc: "LavaSrc fallback",
} as const;

const LOOP_LABEL = { off: "Loop off", track: "🔂 Looping song", queue: "🔁 Looping queue" } as const;

/** "YouTube: <title> — <channel> · via search (score 82) · wrong song? /wrong" */
export function matchFooter(track: Track | UnresolvedTrack): string | null {
  const match = getMatchData(track)?.match;
  if (!match) return null;
  if (match.method === "lavasrc") return "Matched by LavaSrc's fallback search";
  const score = match.score !== null ? ` (score ${match.score})` : "";
  return truncate(
    `YouTube: ${match.ytTitle ?? "?"} — ${match.ytAuthor ?? "?"} · via ${METHOD_LABEL[match.method]}${score} · wrong song? /wrong`,
    2000,
  );
}

/** Apple artwork comes as 3000×3000 (several MB); 600×600 is plenty and loads fast. */
export function artworkFor(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/i, "/600x600bb.jpg");
}

/** The now-playing card, laid out like Apple Music's player: cover art, title, artist · album, progress. */
export function nowPlayingEmbed(player: Player, track: Track): EmbedBuilder {
  const requester = track.requester as Requester | undefined;
  const meta = getMatchData(track)?.apple;
  const duration = track.info.duration;
  const lines: string[] = [];

  // Artist · Album
  const album = meta?.album ? ` · *${escapeMd(truncate(meta.album, 80))}*` : "";
  lines.push(`**${escapeMd(truncate(meta?.artist ?? track.info.author, 100))}**${album}`, "");

  // "3:52 · ends in 2 minutes": Discord counts this down live, no message edits needed.
  lines.push(timingLine(player.position, duration, player.paused, track.info.isStream));

  const next = player.queue.tracks[0];
  if (next) {
    lines.push("", `**Up next** · ${escapeMd(truncate(next.info.title ?? "Unknown", 60))} — ${escapeMd(truncate(next.info.author ?? "", 40))}`);
  }

  // Only modes that are on, in small text; no volume.
  const modes = [
    player.repeatMode !== "off" ? LOOP_LABEL[player.repeatMode] : null,
    player.get<boolean>("autoplay") ? "♾️ Autoplay" : null,
    player.get<string>("filter") ? `🎛️ ${player.get<string>("filter")}` : null,
    player.get<boolean>("stay247") ? "📌 24/7" : null,
    requester ? `Requested by <@${requester.id}>` : null,
  ].filter(Boolean);
  if (modes.length) lines.push("", `-# ${modes.join(" · ")}`);

  const embed = new EmbedBuilder()
    .setColor(player.paused ? Colors.paused : Colors.primary)
    .setAuthor({ name: player.paused ? "⏸  PAUSED" : "▶  NOW PLAYING" })
    .setTitle(truncate(meta?.title ?? track.info.title, 250))
    .setDescription(lines.join("\n"));
  if (track.info.uri) embed.setURL(meta?.uri ?? track.info.uri);
  const art = artworkFor(meta?.artworkUrl ?? track.info.artworkUrl);
  if (art) embed.setImage(art);
  const footer = matchFooter(track);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

function button(id: ControlId, emoji: string, style = ButtonStyle.Secondary, disabled = false, label?: string): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}${id}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(label);
  return b;
}

export function controlRows(player: Player, disabled = false): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const loopEmoji = player.repeatMode === "track" ? "🔂" : "🔁";
  const on = (v: boolean) => (v ? ButtonStyle.Success : ButtonStyle.Secondary);
  // Discord buttons have no hover tooltips, so each one carries a short label saying what it does.
  // Labels that depend on state say what the button does now (e.g. "Resume" while paused).
  const loopLabel = { off: "Loop: off", queue: "Loop: queue", track: "Loop: song" }[player.repeatMode];
  const queueOpen = isQueueOpen(player);
  const autoplayOn = !!player.get<boolean>("autoplay");
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      button("previous", "⏮️", ButtonStyle.Secondary, disabled || player.queue.previous.length === 0, "Previous"),
      button("pause", player.paused ? "▶️" : "⏸️", player.paused ? ButtonStyle.Success : ButtonStyle.Primary, disabled, player.paused ? "Resume" : "Pause"),
      button("skip", "⏭️", ButtonStyle.Secondary, disabled, "Skip"),
      button("stop", "⏹️", ButtonStyle.Danger, disabled, "Stop"),
      button("queue", "📜", on(queueOpen), disabled, queueOpen ? "Hide queue" : "Queue"),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      button("shuffle", "🔀", ButtonStyle.Secondary, disabled || player.queue.tracks.length < 2, "Shuffle"),
      button("loop", loopEmoji, on(player.repeatMode !== "off"), disabled, loopLabel),
      button("autoplay", "♾️", on(autoplayOn), disabled, autoplayOn ? "Autoplay: on" : "Autoplay: off"),
      button("lyrics", "🎤", ButtonStyle.Secondary, disabled, "Lyrics"),
    ),
  ];
}

// ---------- the full message: now playing + (when 📜 is on) the queue ----------

export const isQueueOpen = (player: Player) => !!player.get<boolean>("showQueue");

export function toggleQueue(player: Player): void {
  player.set("showQueue", !isQueueOpen(player));
}

export function setQueuePage(player: Player, page: number): void {
  player.set("queuePage", clampPage(player, page));
}

/** Everything the now-playing message shows. Up to 4 rows: 2 control rows, queue pages, song menu. */
export function playerView(player: Player, track: Track) {
  const embeds = [nowPlayingEmbed(player, track)];
  const components = controlRows(player);
  if (isQueueOpen(player)) {
    const page = clampPage(player, player.get<number>("queuePage") ?? 0);
    embeds.push(buildQueueEmbed(player, page, true));
    components.push(...queueComponents(player, page));
  }
  return { embeds, components };
}

// ---------- live message per guild ----------

interface LiveMessage {
  channelId: string;
  messageId: string;
}
const live = new Map<string, LiveMessage>();

async function fetchLive(client: BotClient, guildId: string) {
  const ref = live.get(guildId);
  if (!ref) return null;
  try {
    const channel = client.channels.cache.get(ref.channelId) ?? (await client.channels.fetch(ref.channelId));
    if (!channel?.isTextBased()) return null;
    return await channel.messages.fetch(ref.messageId);
  } catch {
    live.delete(guildId);
    return null;
  }
}

export function isLiveMessage(guildId: string, messageId: string): boolean {
  return live.get(guildId)?.messageId === messageId;
}

/** How far up the live message may have scrolled before a new song reposts it at the bottom. */
const REUSE_WITHIN_LAST = 5;

/**
 * Show a new song. To avoid one message per song, the existing now-playing message is edited in place.
 * Only if chat has pushed it out of sight is it deleted and posted again at the bottom.
 */
export async function postNowPlaying(client: BotClient, player: Player, track: Track): Promise<void> {
  const existing = await fetchLive(client, player.guildId);
  if (existing) {
    const recent = await existing.channel.messages.fetch({ limit: REUSE_WITHIN_LAST }).catch(() => null);
    if (recent?.has(existing.id)) {
      const edited = await existing.edit({ ...playerView(player, track), allowedMentions: { parse: [] } }).then(
        () => true,
        () => false,
      );
      if (edited) return;
    }
    live.delete(player.guildId);
    // Scrolled away: remove it (or at least its buttons) so only one player message exists.
    await existing.delete().catch(() => existing.edit({ components: [] }).catch(() => undefined));
  }
  const message = await sendToPlayerChannel(client, player, {
    ...playerView(player, track),
    allowedMentions: { parse: [] },
  });
  if (message) live.set(player.guildId, { channelId: message.channelId, messageId: message.id });
}

/** Make an existing message (e.g. the /nowplaying reply) the live one, retiring the old. */
export async function adoptLiveMessage(client: BotClient, guildId: string, channelId: string, messageId: string): Promise<void> {
  if (live.get(guildId)?.messageId !== messageId) await retireNowPlaying(client, guildId);
  live.set(guildId, { channelId, messageId });
}

/** Re-render the live message (after pause, loop, volume… changes). */
export async function refreshNowPlaying(client: BotClient, player: Player): Promise<void> {
  const track = player.queue.current;
  if (!track) return;
  const message = await fetchLive(client, player.guildId);
  if (!message) return;
  await message
    .edit(playerView(player, track))
    .catch((error: unknown) => logger.debug({ err: error }, "Could not refresh now-playing message"));
}

/** Remove the buttons from the live message (track ended, bot left). */
export async function retireNowPlaying(client: BotClient, guildId: string): Promise<void> {
  const message = await fetchLive(client, guildId);
  live.delete(guildId);
  if (!message) return;
  await message.edit({ components: [] }).catch(() => undefined);
}
