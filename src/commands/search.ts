import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { SearchPlatform, Track } from "lavalink-client";
import { config } from "../config.js";
import { cancelIdleTimer } from "../music/idleManager.js";
import { wrapAppleTracks } from "../music/trackResolver.js";
import { Colors, errorEmbed, respond, successEmbed } from "../utils/embeds.js";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { checkVoice } from "../utils/voice.js";
import type { Command } from "../utils/types.js";

const RESULTS = 10;
const PICK_TIMEOUT_MS = 60_000;

export const search: Command = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search and pick from the top results")
    .addStringOption((o) => o.setName("query").setDescription("What to search for").setRequired(true).setMaxLength(200))
    .addStringOption((o) =>
      o
        .setName("source")
        .setDescription("Where to search (default YouTube Music)")
        .addChoices(
          { name: "YouTube Music", value: "ytmsearch" },
          { name: "YouTube", value: "ytsearch" },
          { name: "Apple Music", value: "amsearch" },
          { name: "Spotify", value: "spsearch" },
        ),
    ),

  async execute(interaction, client) {
    const voice = await checkVoice(interaction, client, { willJoin: true });
    if (!voice) return;
    if (!client.lavalink.useable) {
      await respond(interaction, errorEmbed("The audio server isn't connected yet. Try again in a few seconds."), true);
      return;
    }

    const query = interaction.options.getString("query", true);
    const source = (interaction.options.getString("source") ?? "ytmsearch") as SearchPlatform;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const player =
      voice.player ??
      client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voice.channel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: config.defaultVolume,
      });

    let tracks: Track[] = [];
    try {
      const res = await player.search({ query, source }, interaction.user);
      tracks = res.tracks.filter((t): t is Track => typeof t.encoded === "string").slice(0, RESULTS);
    } catch (error) {
      logger.warn({ err: error, query, source }, "/search failed");
    }
    if (tracks.length === 0) {
      await respond(interaction, errorEmbed(`No results for **${escapeMd(truncate(query, 100))}**.`));
      if (!voice.player) await player.destroy("NothingToPlay").catch(() => undefined);
      return;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("search:pick")
      .setPlaceholder("Pick a song to add")
      .addOptions(
        tracks.map((t, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncate(`${i + 1}. ${t.info.title}`, 100))
            .setDescription(truncate(`${t.info.author} · ${formatDuration(t.info.duration)}`, 100))
            .setValue(String(i)),
        ),
      );
    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle(`Results for "${truncate(query, 80)}"`)
      .setDescription(
        tracks
          .map((t, i) => `\`${i + 1}.\` ${escapeMd(truncate(t.info.title, 70))} — ${escapeMd(truncate(t.info.author, 30))} \`${formatDuration(t.info.duration)}\``)
          .join("\n"),
      );

    const reply = await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });

    let picked;
    try {
      picked = await reply.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: PICK_TIMEOUT_MS,
        filter: (i) => i.user.id === interaction.user.id,
      });
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("No song picked, search closed.")], components: [] });
      if (!voice.player && !player.queue.current) await player.destroy("NothingToPlay").catch(() => undefined);
      return;
    }

    const track = tracks[Number(picked.values[0])]!;
    try {
      if (!player.connected) await player.connect();
      cancelIdleTimer(interaction.guildId);
      await player.queue.add(wrapAppleTracks([track]));
      if (!player.playing && !player.paused) await player.play();
    } catch (error) {
      logger.error({ err: error }, "/search failed to queue the pick");
      await picked.update({ embeds: [errorEmbed("Couldn't add that song.")], components: [] });
      return;
    }
    await picked.update({
      embeds: [successEmbed(`Added **${escapeMd(truncate(track.info.title, 80))}** — position ${player.queue.tracks.length || "now playing"}.`)],
      components: [],
    });
  },
};
