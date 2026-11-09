import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Player, Track } from "lavalink-client";
import { Colors, errorEmbed, respond } from "../utils/embeds.js";
import { escapeMd, truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { checkVoice } from "../utils/voice.js";
import { freshCopy, getMatchData, rematchAfterWrong } from "../music/trackResolver.js";
import { matchFooter } from "../music/nowPlaying.js";
import type { Command } from "../utils/types.js";

export const wrong: Command = {
  data: new SlashCommandBuilder()
    .setName("wrong")
    .setDescription("Wrong song? Skip it, never use that video for this song again, and try the next-best match"),

  async execute(interaction, client) {
    const ctx = await checkVoice(interaction, client, { requirePlayer: true });
    if (!ctx?.player) return;
    const { player } = ctx;
    const current = player.queue.current;
    const data = getMatchData(current);

    if (!current || !data) {
      await respond(interaction, errorEmbed("`/wrong` only works for Apple Music and Spotify tracks (they're matched to YouTube). Use `/skip` for this one."), true);
      return;
    }
    if (!data.match?.videoId) {
      await respond(
        interaction,
        errorEmbed("I didn't find a confident match for this song, so LavaSrc picked it. There's no better candidate to try. Use `/skip`."),
        true,
      );
      return;
    }

    await interaction.deferReply();
    const badTitle = data.match.ytTitle ?? data.match.videoId;

    let result;
    try {
      result = await rematchAfterWrong(player, current);
    } catch (error) {
      logger.error({ err: error }, "/wrong failed");
      await respond(interaction, errorEmbed("Something went wrong while finding another match."));
      return;
    }
    if (!result) {
      await respond(interaction, errorEmbed("Couldn't re-match this track."));
      return;
    }

    // Other copies of the same song in the queue (or the loop) still point at the bad video.
    replaceStaleCopies(player, data.apple.appleId, result.blacklisted);

    await player.queue.add(result.replacement, 0);
    const wasTrackLoop = player.repeatMode === "track";
    if (wasTrackLoop) await player.setRepeatMode("off"); // otherwise skip would replay the bad match
    await player.skip(0, false);
    if (wasTrackLoop) await player.setRepeatMode("track");

    const newFooter = matchFooter(result.replacement);
    const embed = new EmbedBuilder()
      .setColor(Colors.warning)
      .setTitle("Got it, trying another match")
      .setDescription(
        `**${escapeMd(truncate(data.apple.title, 100))}** — ${escapeMd(truncate(data.apple.artist, 60))}\n` +
          `❌ Won't use again: ${escapeMd(truncate(badTitle, 100))} (\`${result.blacklisted}\`)\n` +
          (getMatchData(result.replacement)?.match?.method === "lavasrc"
            ? "No other candidate scored high enough, so LavaSrc's fallback search is trying instead."
            : `▶️ Now trying: ${escapeMd(truncate(getMatchData(result.replacement)?.match?.ytTitle ?? "?", 100))}`),
      );
    if (newFooter) embed.setFooter({ text: newFooter });
    await respond(interaction, embed);
  },
};

function replaceStaleCopies(player: Player, appleId: string, badVideoId: string): void {
  const tracks = player.queue.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i] as Track;
    const d = getMatchData(t);
    if (d?.apple.appleId === appleId && d.match?.videoId === badVideoId) {
      const copy = freshCopy(t);
      if (copy) void player.queue.splice(i, 1, copy);
    }
  }
}
