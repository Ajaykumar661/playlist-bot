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
import { escapeMd, formatDuration, progressBar, truncate } from "../utils/format.js";
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
  | "voldown"
  | "volup"
  | "autoplay";

const METHOD_LABEL = {
  cache: "cached match",
  "isrc-deezer": "Deezer ISRC",
  "isrc-youtube": "ISRC",
  search: "search",
  lavasrc: "LavaSrc fallback",
} as const;

const LOOP_LABEL = { off: "Off", track: "🔂 Track", queue: "🔁 Queue" } as const;

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

export function nowPlayingEmbed(player: Player, track: Track, withProgress = false): EmbedBuilder {
  const requester = track.requester as Requester | undefined;
  const duration = track.info.duration;
  const lines = [
    `by **${escapeMd(track.info.author)}** · \`${track.info.isStream ? "LIVE" : formatDuration(duration)}\`` +
      (requester ? ` · requested by <@${requester.id}>` : ""),
  ];
  if (withProgress && !track.info.isStream) {
    const position = duration > 0 ? Math.min(player.position, duration) : player.position;
    lines.push("", progressBar(position, duration), `\`${formatDuration(position)} / ${formatDuration(duration)}\``);
  }

  const status = [
    `🔊 ${player.volume}%`,
    `Loop: ${LOOP_LABEL[player.repeatMode]}`,
    `Up next: ${player.queue.tracks.length}`,
    player.get<boolean>("autoplay") ? "♾️ Autoplay" : null,
    player.get<string>("filter") ? `🎛️ ${player.get<string>("filter")}` : null,
    player.get<boolean>("stay247") ? "📌 24/7" : null,
  ].filter(Boolean);
  lines.push("", status.join(" · "));

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setAuthor({ name: player.paused ? "⏸️ Paused" : "▶️ Now playing" })
    .setTitle(truncate(track.info.title, 250))
    .setDescription(lines.join("\n"));
  if (track.info.uri) embed.setURL(track.info.uri);
  if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
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
      button("voldown", "🔉", ButtonStyle.Secondary, disabled || player.volume <= 0, "Vol −"),
      button("volup", "🔊", ButtonStyle.Secondary, disabled || player.volume >= 150, "Vol +"),
      button("autoplay", "♾️", on(autoplayOn), disabled, autoplayOn ? "Autoplay: on" : "Autoplay: off"),
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
export function playerView(player: Player, track: Track, withProgress = false) {
  const embeds = [nowPlayingEmbed(player, track, withProgress)];
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

/** Post a fresh now-playing message and strip the buttons from the previous one. */
export async function postNowPlaying(client: BotClient, player: Player, track: Track): Promise<void> {
  await retireNowPlaying(client, player.guildId);
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
