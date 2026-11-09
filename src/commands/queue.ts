import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  EmbedBuilder,
  SlashCommandBuilder,
  type Message,
} from "discord.js";
import type { Player } from "lavalink-client";
import { Colors, replyError } from "../utils/embeds.js";
import { escapeMd, formatDuration, pluralize, truncate } from "../utils/format.js";
import type { Command } from "../utils/types.js";
import { queuePickRow } from "../music/picker.js";

const PAGE_SIZE = 10;
const COLLECTOR_IDLE_MS = 2 * 60 * 1000;

function pageCount(player: Player): number {
  return Math.max(1, Math.ceil(player.queue.tracks.length / PAGE_SIZE));
}

export function buildQueueEmbed(player: Player, page: number): EmbedBuilder {
  const tracks = player.queue.tracks;
  const pages = pageCount(player);
  const start = page * PAGE_SIZE;
  const slice = tracks.slice(start, start + PAGE_SIZE);
  const current = player.queue.current;

  const lines = slice.map((t, i) => {
    const title = escapeMd(truncate(t.info.title ?? "Unknown", 60));
    const author = escapeMd(truncate(t.info.author ?? "Unknown", 30));
    return `\`${String(start + i + 1).padStart(3, " ")}.\` ${title} — ${author} \`${formatDuration(t.info.duration ?? 0)}\``;
  });

  const totalMs = tracks.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle("Queue")
    .setDescription(
      [
        current
          ? `**Now playing:** ${escapeMd(truncate(current.info.title, 80))} — ${escapeMd(truncate(current.info.author, 40))}`
          : "**Now playing:** nothing",
        "",
        lines.length ? lines.join("\n") : "*No upcoming tracks.*",
      ].join("\n"),
    )
    .setFooter({
      text: `Page ${page + 1}/${pages} · ${pluralize(tracks.length, "track")} · ${formatDuration(totalMs)} total · loop: ${player.repeatMode}`,
    });
  return embed;
}

/** Page buttons (when there is more than one page) plus the "play a song from this page" menu. */
export function queueComponents(player: Player, page: number, disabledButtons = false) {
  const pages = pageCount(player);
  const pick = queuePickRow(player, page, PAGE_SIZE);
  return [...(pages > 1 ? [buildButtons(page, pages, disabledButtons)] : []), ...(pick ? [pick] : [])];
}

function buildButtons(page: number, pages: number, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("queue:first").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId("queue:prev").setEmoji("◀️").setStyle(ButtonStyle.Primary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId("queue:next").setEmoji("▶️").setStyle(ButtonStyle.Primary).setDisabled(disabled || page >= pages - 1),
    new ButtonBuilder().setCustomId("queue:last").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= pages - 1),
  );
}

export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the queue")
    .addIntegerOption((o) => o.setName("page").setDescription("Page to open").setMinValue(1)),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
      await replyError(interaction, "The queue is empty. Use `/play` to add something.");
      return;
    }

    let page = Math.min((interaction.options.getInteger("page") ?? 1) - 1, pageCount(player) - 1);

    const message: Message = await interaction
      .reply({
        embeds: [buildQueueEmbed(player, page)],
        components: queueComponents(player, page),
        withResponse: true,
      })
      .then((r) => r.resource!.message!);

    if (pageCount(player) <= 1) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: COLLECTOR_IDLE_MS,
    });

    collector.on("collect", (button) => {
      void (async () => {
        if (button.user.id !== interaction.user.id) {
          await button.reply({ content: "Run `/queue` yourself to browse the queue.", flags: MessageFlags.Ephemeral });
          return;
        }
        // Re-read the player each click: the queue may have changed or the bot may have left.
        const live = client.lavalink.getPlayer(interaction.guildId);
        if (!live) {
          collector.stop("player-gone");
          await button.update({ embeds: [new EmbedBuilder().setColor(Colors.info).setDescription("The queue is gone.")], components: [] });
          return;
        }
        const pages = pageCount(live);
        if (button.customId === "queue:first") page = 0;
        else if (button.customId === "queue:prev") page = Math.max(0, page - 1);
        else if (button.customId === "queue:next") page = Math.min(pages - 1, page + 1);
        else if (button.customId === "queue:last") page = pages - 1;
        page = Math.min(page, pages - 1);
        await button.update({ embeds: [buildQueueEmbed(live, page)], components: queueComponents(live, page) });
      })().catch(() => undefined);
    });

    collector.on("end", (_collected, reason) => {
      if (reason === "player-gone") return;
      // The page buttons stop here; the song menu keeps working (it's handled globally, not by this collector).
      const live = client.lavalink.getPlayer(interaction.guildId);
      const components = live ? queueComponents(live, Math.min(page, pageCount(live) - 1), true) : [];
      void message.edit({ components }).catch(() => undefined);
    });
  },
};
