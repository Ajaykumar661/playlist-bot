import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Track, UnresolvedTrack } from "lavalink-client";
import { classifyQuery } from "../music/resolve.js";
import { suggestTracks } from "../music/suggest.js";
import { wrapAppleTracks } from "../music/trackResolver.js";
import { refreshNowPlaying } from "../music/nowPlaying.js";
import { Colors, errorEmbed, respond } from "../utils/embeds.js";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { Command, Requester } from "../utils/types.js";
import { LIBRARY_LINK_MESSAGE, search } from "./play.js";

/** How many requested songs one person can have waiting in the queue at once. */
export const MAX_WAITING_REQUESTS = 3;

/**
 * Song requests: anyone in the server can add one song to the END of the queue.
 * Unlike /play it never starts, skips or reorders anything, and you don't need to be in the voice channel.
 */
export const songrequest: Command = {
  data: new SlashCommandBuilder()
    .setName("songrequest")
    .setDescription("Request a song: it's added to the end of the queue without changing anything else")
    .addStringOption((o) =>
      o
        .setName("song")
        .setDescription("Type a song name and pick from the suggestions, or paste a song link")
        .setRequired(true)
        .setMaxLength(500)
        .setAutocomplete(true),
    ),
  autocomplete: suggestTracks,

  async execute(interaction, client) {
    const input = interaction.options.getString("song", true);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player?.queue.current) {
      await respond(interaction, errorEmbed("Nothing is playing right now. Join a voice channel and use `/play` to start."), true);
      return;
    }

    const query = classifyQuery(input);
    if (query.kind === "apple-library") {
      await respond(interaction, errorEmbed(LIBRARY_LINK_MESSAGE), true);
      return;
    }

    const waiting = player.queue.tracks.filter((t) => (t.requester as Requester | undefined)?.id === interaction.user.id).length;
    if (waiting >= MAX_WAITING_REQUESTS) {
      await respond(
        interaction,
        errorEmbed(`You already have ${waiting} songs waiting in the queue. Request another one after one of them plays.`),
        true,
      );
      return;
    }

    await interaction.deferReply();
    let track: Track | UnresolvedTrack | undefined;
    try {
      const result = await search(player, query, interaction.user);
      if (result.loadType === "playlist") {
        await respond(interaction, errorEmbed("Song requests take one song at a time, not a playlist or album."));
        return;
      }
      track = result.loadType === "error" ? undefined : result.tracks[0];
    } catch (error) {
      logger.warn({ err: error, input }, "/songrequest search failed");
    }
    if (!track) {
      await respond(interaction, errorEmbed(`I couldn't find **${escapeMd(truncate(input, 100))}**.`));
      return;
    }

    // Wait time = rest of the current song + everything already queued.
    const current = player.queue.current;
    const remaining = current && !current.info.isStream ? Math.max(0, current.info.duration - player.position) : 0;
    const waitMs = remaining + player.queue.tracks.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);

    await player.queue.add(wrapAppleTracks([track]));
    const position = player.queue.tracks.length;

    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setAuthor({ name: `🎟️ Song request added · position ${position}` })
      .setTitle(truncate(track.info.title ?? "Unknown title", 250))
      .setDescription(
        `by **${escapeMd(track.info.author ?? "Unknown artist")}** · \`${formatDuration(track.info.duration ?? 0)}\`\n` +
          `Requested by <@${interaction.user.id}> · plays in about **${formatDuration(waitMs)}**`,
      )
      .setFooter({ text: `Up to ${MAX_WAITING_REQUESTS} requests per person can wait in the queue.` });
    if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    await refreshNowPlaying(client, player);
  },
};
