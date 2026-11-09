import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
} from "discord.js";
import type { Player } from "lavalink-client";
import { Colors, replyError } from "../utils/embeds.js";
import { escapeMd, formatDuration, pluralize, truncate } from "../utils/format.js";
import type { BotClient, Command } from "../utils/types.js";
import { queuePickRow } from "../music/picker.js";

const PAGE_SIZE = 10;
/** Page buttons are handled globally (not by a collector), so they work on every queue message and never expire. */
export const QUEUE_PAGE_PREFIX = "queue:";

function pageCount(player: Player): number {
  return Math.max(1, Math.ceil(player.queue.tracks.length / PAGE_SIZE));
}

const clampPage = (player: Player, page: number) => Math.max(0, Math.min(page, pageCount(player) - 1));

export function buildQueueEmbed(player: Player, page: number): EmbedBuilder {
  const tracks = player.queue.tracks;
  const pages = pageCount(player);
  page = clampPage(player, page);
  const start = page * PAGE_SIZE;
  const slice = tracks.slice(start, start + PAGE_SIZE);
  const current = player.queue.current;

  const lines = slice.map((t, i) => {
    const title = escapeMd(truncate(t.info.title ?? "Unknown", 60));
    const author = escapeMd(truncate(t.info.author ?? "Unknown", 30));
    return `\`${String(start + i + 1).padStart(3, " ")}.\` ${title} — ${author} \`${formatDuration(t.info.duration ?? 0)}\``;
  });

  const totalMs = tracks.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);

  return new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle(`Queue · ${pluralize(tracks.length, "upcoming track")}`)
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
      text:
        `Page ${page + 1}/${pages}${pages > 1 ? " (◀️ ▶️ for more)" : ""} · ${formatDuration(totalMs)} total · ` +
        `loop: ${player.repeatMode}`,
    });
}

function buildButtons(page: number, pages: number): ActionRowBuilder<ButtonBuilder> {
  // Custom ids must be unique within a message, so each one carries its name as well as the target page.
  const button = (name: string, emoji: string, target: number, style: ButtonStyle, disabled: boolean) =>
    new ButtonBuilder().setCustomId(`${QUEUE_PAGE_PREFIX}${name}:${target}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("first", "⏮️", 0, ButtonStyle.Secondary, page === 0),
    button("prev", "◀️", page - 1, ButtonStyle.Primary, page === 0),
    button("next", "▶️", page + 1, ButtonStyle.Primary, page >= pages - 1),
    button("last", "⏭️", pages - 1, ButtonStyle.Secondary, page >= pages - 1),
  );
}

/** Page buttons (when there is more than one page) plus the "play a song from this page" menu. */
export function queueComponents(player: Player, page: number) {
  page = clampPage(player, page);
  const pages = pageCount(player);
  const pick = queuePickRow(player, page, PAGE_SIZE);
  return [...(pages > 1 ? [buildButtons(page, pages)] : []), ...(pick ? [pick] : [])];
}

export const isQueuePageButton = (customId: string) => customId.startsWith(QUEUE_PAGE_PREFIX);

export async function handleQueuePageButton(interaction: ButtonInteraction<"cached">, client: BotClient): Promise<void> {
  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    await interaction.update({ embeds: [new EmbedBuilder().setColor(Colors.info).setDescription("The queue is gone.")], components: [] });
    return;
  }
  const page = clampPage(player, Number(interaction.customId.split(":").pop()) || 0);
  const view = { embeds: [buildQueueEmbed(player, page)], components: queueComponents(player, page) };

  // Someone else's /queue message: show them their own copy instead of flipping it for everyone.
  const owner = interaction.message.interactionMetadata?.user.id;
  if (owner && owner !== interaction.user.id) {
    await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(view);
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
    const page = clampPage(player, (interaction.options.getInteger("page") ?? 1) - 1);
    await interaction.reply({ embeds: [buildQueueEmbed(player, page)], components: queueComponents(player, page) });
  },
};
