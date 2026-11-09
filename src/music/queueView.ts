/**
 * The queue list: an embed page, ◀️ ▶️ page buttons and the "pick a song" menu.
 * Shown inside the now-playing message (📜 button) and by /queue.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type MessageActionRowComponentBuilder } from "discord.js";
import type { Player } from "lavalink-client";
import { Colors } from "../utils/embeds.js";
import { escapeMd, formatDuration, pluralize, truncate } from "../utils/format.js";
import { queuePickRow } from "./picker.js";

export const PAGE_SIZE = 10;
/** Page buttons are handled globally (not by a collector), so they work on every queue message and never expire. */
export const QUEUE_PAGE_PREFIX = "queue:";

export const isQueuePageButton = (customId: string) => customId.startsWith(QUEUE_PAGE_PREFIX);
export const pageFromButton = (customId: string) => Number(customId.split(":").pop()) || 0;

function pageCount(player: Player): number {
  return Math.max(1, Math.ceil(player.queue.tracks.length / PAGE_SIZE));
}

export const clampPage = (player: Player, page: number) => Math.max(0, Math.min(page, pageCount(player) - 1));

/** The queue page. `compact` leaves out "Now playing" (the now-playing embed above it already shows it). */
export function buildQueueEmbed(player: Player, page: number, compact = false): EmbedBuilder {
  const tracks = player.queue.tracks;
  const pages = pageCount(player);
  page = clampPage(player, page);
  const start = page * PAGE_SIZE;
  const current = player.queue.current;

  const lines = tracks.slice(start, start + PAGE_SIZE).map((t, i) => {
    const title = escapeMd(truncate(t.info.title ?? "Unknown", 60));
    const author = escapeMd(truncate(t.info.author ?? "Unknown", 30));
    return `\`${String(start + i + 1).padStart(3, " ")}.\` ${title} — ${author} \`${formatDuration(t.info.duration ?? 0)}\``;
  });
  const list = lines.length ? lines.join("\n") : "*No upcoming tracks. Add some with `/play`.*";
  const nowPlaying = current
    ? `**Now playing:** ${escapeMd(truncate(current.info.title, 80))} — ${escapeMd(truncate(current.info.author, 40))}`
    : "**Now playing:** nothing";
  const totalMs = tracks.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);

  return new EmbedBuilder()
    .setColor(compact ? Colors.info : Colors.primary)
    .setTitle(`📜 Queue · ${pluralize(tracks.length, "upcoming track")}`)
    .setDescription(compact ? list : `${nowPlaying}\n\n${list}`)
    .setFooter({
      text: `Page ${page + 1}/${pages}${pages > 1 ? " (◀️ ▶️ for more)" : ""} · ${formatDuration(totalMs)} total · loop: ${player.repeatMode}`,
    });
}

function pageButtons(page: number, pages: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
  // Custom ids must be unique within a message, so each one carries its name as well as the target page.
  const button = (name: string, emoji: string, label: string, target: number, style: ButtonStyle, disabled: boolean) =>
    new ButtonBuilder()
      .setCustomId(`${QUEUE_PAGE_PREFIX}${name}:${target}`)
      .setEmoji(emoji)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    button("first", "⏮️", "First page", 0, ButtonStyle.Secondary, page === 0),
    button("prev", "◀️", "Back", page - 1, ButtonStyle.Primary, page === 0),
    button("next", "▶️", "More", page + 1, ButtonStyle.Primary, page >= pages - 1),
    button("last", "⏭️", "Last page", pages - 1, ButtonStyle.Secondary, page >= pages - 1),
  );
}

/** Page buttons (when there is more than one page) plus the "pick a song from this page" menu. */
export function queueComponents(player: Player, page: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  page = clampPage(player, page);
  const pages = pageCount(player);
  const pick = queuePickRow(player, page, PAGE_SIZE);
  return [
    ...(pages > 1 ? [pageButtons(page, pages)] : []),
    ...(pick ? [pick as ActionRowBuilder<MessageActionRowComponentBuilder>] : []),
  ];
}
