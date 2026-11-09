import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getMatchData } from "../music/trackResolver.js";
import { Colors, errorEmbed, respond, successEmbed } from "../utils/embeds.js";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";
import type { Command } from "../utils/types.js";

export const grab: Command = {
  data: new SlashCommandBuilder().setName("grab").setDescription("DM yourself the song that's playing"),
  async execute(interaction, client) {
    const track = client.lavalink.getPlayer(interaction.guildId)?.queue.current;
    if (!track) {
      await respond(interaction, errorEmbed("Nothing is playing right now."), true);
      return;
    }
    const match = getMatchData(track)?.match;
    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setAuthor({ name: `Saved from ${interaction.guild.name}` })
      .setTitle(truncate(track.info.title, 250))
      .setDescription(
        [
          `by **${escapeMd(track.info.author)}** · \`${formatDuration(track.info.duration)}\``,
          track.info.uri ? `🔗 ${track.info.uri}` : null,
          match?.videoId ? `▶️ https://youtu.be/${match.videoId}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

    try {
      await interaction.user.send({ embeds: [embed] });
      await respond(interaction, successEmbed("Sent you a DM with the song."), true);
    } catch {
      await respond(interaction, errorEmbed("I couldn't DM you. Allow DMs from server members and try again."), true);
    }
  },
};
