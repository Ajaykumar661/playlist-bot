import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Player, SearchResult, UnresolvedSearchResult } from "lavalink-client";
import { config } from "../config.js";
import { classifyQuery } from "../music/resolve.js";
import { cancelIdleTimer } from "../music/idleManager.js";
import { wrapAppleTracks } from "../music/trackResolver.js";
import { Colors, errorEmbed, respond } from "../utils/embeds.js";
import { escapeMd, formatDuration, pluralize, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { checkVoice } from "../utils/voice.js";
import type { BotClient, Command } from "../utils/types.js";

type AnyResult = SearchResult | UnresolvedSearchResult;

const LIBRARY_LINK_MESSAGE =
  "That's a link to a playlist in your **personal library**, which only you can see.\n" +
  "To share it publicly: open the playlist in Apple Music → **⋯** → **Share Playlist** (or *Make Public* / " +
  "*Show on My Profile*) → **Copy Link**, then use that `music.apple.com/…/playlist/…/pl.u-…` link.";

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play an Apple Music, Spotify or YouTube link (playlist, album, song), or search for a song")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("Apple Music / Spotify / YouTube link, or search text")
        .setRequired(true)
        .setMaxLength(500),
    ),

  async execute(interaction, client) {
    await runPlay(interaction, client, interaction.options.getString("query", true), false);
  },
};

/** Shared by /play (add to the end) and /playnext (add to the front, `next = true`). */
export async function runPlay(
  interaction: ChatInputCommandInteraction<"cached">,
  client: BotClient,
  input: string,
  next: boolean,
): Promise<void> {
  {
    const query = classifyQuery(input);

    if (query.kind === "apple-library") {
      await respond(interaction, errorEmbed(LIBRARY_LINK_MESSAGE), true);
      return;
    }

    const voice = await checkVoice(interaction, client, { willJoin: true });
    if (!voice) return;

    if (!client.lavalink.useable) {
      await respond(
        interaction,
        errorEmbed("The audio server (Lavalink) isn't connected yet. Wait a few seconds and try again."),
        true,
      );
      return;
    }

    await interaction.deferReply();

    const createdPlayer = !voice.player;
    const player =
      voice.player ??
      client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voice.channel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        selfMute: false,
        volume: config.defaultVolume,
      });

    try {
      if (!player.connected) await player.connect();
    } catch (error) {
      logger.error({ err: error, guildId: interaction.guildId }, "Failed to join voice channel");
      await respond(interaction, errorEmbed("I couldn't join your voice channel."));
      if (!player.queue.current) await player.destroy("JoinFailed").catch(() => undefined);
      return;
    }

    let result: AnyResult;
    try {
      result = await search(player, query, interaction.user);
    } catch (error) {
      logger.warn({ err: error, input }, "Search failed");
      await respond(interaction, errorEmbed(`Search failed: ${escapeMd(errorMessage(error))}`));
      if (createdPlayer) await destroyIfIdle(player);
      return;
    }

    if (result.loadType === "error") {
      const msg = result.exception?.message ?? "unknown error";
      logger.warn({ input, exception: result.exception }, "Lavalink failed to load query");
      await respond(interaction, errorEmbed(loadErrorText(query.kind, msg, input)));
      if (createdPlayer) await destroyIfIdle(player);
      return;
    }

    if (result.loadType === "empty" || result.tracks.length === 0) {
      await respond(
        interaction,
        errorEmbed(
          query.kind === "apple"
            ? "I couldn't load anything from that Apple Music link. Make sure it's **public** and available in the " +
                `**${config.appleMusicCountryCode.toUpperCase()}** storefront.`
            : query.kind === "url"
              ? "I couldn't load anything from that link. Make sure it's **public**, and that it's an Apple Music, Spotify or YouTube link."
              : `No results for **${escapeMd(truncate(input, 100))}**.`,
        ),
      );
      if (createdPlayer) await destroyIfIdle(player);
      return;
    }

    cancelIdleTimer(interaction.guildId);
    const wasIdle = !player.playing && !player.paused && !player.queue.current;

    // Apple tracks are matched to YouTube by our own matcher, lazily, right before each one plays.
    const tracks = wrapAppleTracks(result.loadType === "playlist" ? result.tracks : [result.tracks[0]!]);
    if (next) await player.queue.add(tracks, 0);
    else await player.queue.add(tracks);

    if (result.loadType === "playlist") {
      await respond(interaction, playlistEmbed(result, interaction.user.id, next));
    } else {
      const track = result.tracks[0]!;
      const position = next ? 1 : player.queue.tracks.length;
      const embed = new EmbedBuilder()
        .setColor(Colors.primary)
        .setAuthor({
          name: wasIdle ? "Starting playback" : next ? "Playing next" : `Added to queue · position ${position}`,
        })
        .setTitle(truncate(track.info.title ?? "Unknown title", 250))
        .setDescription(
          `by **${escapeMd(track.info.author ?? "Unknown artist")}** · \`${formatDuration(track.info.duration ?? 0)}\``,
        );
      if (track.info.uri) embed.setURL(track.info.uri);
      if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
      await respond(interaction, embed);
    }

    if (!player.playing && !player.paused) {
      try {
        await player.play();
      } catch (error) {
        logger.error({ err: error, guildId: interaction.guildId }, "Failed to start playback");
        await interaction
          .followUp({ embeds: [errorEmbed(`Couldn't start playback: ${escapeMd(errorMessage(error))}`)] })
          .catch(() => undefined);
      }
    }
  }
}

async function search(player: Player, query: ReturnType<typeof classifyQuery>, requester: unknown): Promise<AnyResult> {
  switch (query.kind) {
    case "apple":
    case "url":
      // LavaSrc recognises music.apple.com links and returns Apple metadata.
      // Each track is matched to Deezer/YouTube when it's played.
      return player.search({ query: query.url }, requester);
    case "search": {
      // Search Apple Music first so the ISRC match chain applies, then fall back to YouTube Music.
      const apple = await player.search({ query: query.text, source: "amsearch" }, requester).catch(() => null);
      if (apple && apple.loadType !== "error" && apple.tracks.length > 0) {
        return { ...apple, loadType: "track", tracks: [apple.tracks[0]!] } as AnyResult;
      }
      return player.search({ query: query.text, source: "ytmsearch" }, requester);
    }
    default:
      throw new Error("Unsupported query");
  }
}

function playlistEmbed(result: AnyResult, userId: string, next = false): EmbedBuilder {
  const tracks = result.tracks;
  const first = tracks[0];
  const totalMs = tracks.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);
  const name = result.playlist?.name || result.playlist?.title || "Playlist";
  const kind = result.pluginInfo?.type === "album" ? "Album" : result.pluginInfo?.type === "artist" ? "Artist" : "Playlist";
  const total = result.pluginInfo?.totalTracks;
  const artwork = result.playlist?.thumbnail || result.pluginInfo?.artworkUrl || first?.info.artworkUrl;
  const url = result.playlist?.uri || result.pluginInfo?.url;

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setAuthor({ name: next ? `${kind} queued to play next` : `${kind} queued` })
    .setTitle(truncate(name, 250))
    .addFields(
      {
        name: "Tracks",
        value:
          typeof total === "number" && total > tracks.length
            ? `${tracks.length} of ${total} (load limit reached)`
            : pluralize(tracks.length, "track"),
        inline: true,
      },
      { name: "Total duration", value: formatDuration(totalMs), inline: true },
      { name: "Requested by", value: `<@${userId}>`, inline: true },
    );
  if (first) {
    embed.addFields({
      name: "First track",
      value: `${escapeMd(truncate(first.info.title ?? "Unknown", 100))} — ${escapeMd(first.info.author ?? "Unknown")}`,
    });
  }
  if (result.playlist?.author || result.pluginInfo?.author) {
    embed.setDescription(`by **${escapeMd(result.playlist?.author || result.pluginInfo?.author || "")}**`);
  }
  if (url) embed.setURL(url);
  if (artwork) embed.setThumbnail(artwork);
  embed.setFooter({ text: "Songs that can't be matched will be skipped and listed at the end." });
  return embed;
}

function loadErrorText(kind: string, message: string, input: string): string {
  const lower = message.toLowerCase();
  if (/open.spotify.com|spotify:/i.test(input)) {
    if (/37i9dq|generated|editorial/i.test(input + lower)) {
      return "Spotify doesn't let apps read its own editorial/algorithmic playlists (Today's Top Hits, Daily Mix, Discover Weekly…). Copy the songs into a playlist of your own and share that.";
    }
    if (/\/(playlist|album)\//i.test(input)) {
      return (
        "Spotify no longer lets bots read **playlists or albums** with app credentials (only single songs and search). " +
        "Use the Apple Music or YouTube link for this playlist instead, or `/play` the songs one by one. " +
        "(Server admins: README > Spotify explains the optional fix.)"
      );
    }
    return (
      "Couldn't load that Spotify link. Spotify needs `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` " +
      "(README > Spotify)."
    );
  }
  if (kind === "apple" && (lower.includes("401") || lower.includes("403") || lower.includes("token"))) {
    return "Apple Music rejected the request (token problem). Check `APPLE_MUSIC_MEDIA_API_TOKEN` or leave it empty, then restart Lavalink.";
  }
  if (kind === "apple" && lower.includes("404")) {
    return "Apple Music says that link doesn't exist. Make sure the playlist is **public** and the link is complete.";
  }
  return `Couldn't load that: ${escapeMd(truncate(message, 300))}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function destroyIfIdle(player: Player): Promise<void> {
  if (!player.queue.current && player.queue.tracks.length === 0) {
    await player.destroy("NothingToPlay").catch(() => undefined);
  }
}
