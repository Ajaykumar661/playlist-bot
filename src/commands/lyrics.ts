import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { findLyrics, findLyricsForTrack, parseLrc, type LrclibTrack } from "../music/lyrics.js";
import { startLiveLyrics } from "../music/liveLyrics.js";
import { Colors, errorEmbed, infoEmbed, respond } from "../utils/embeds.js";
import { truncate } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { Command } from "../utils/types.js";

const PAGE = 3900;

export const lyrics: Command = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Rolling lyrics for the current song, or the full lyrics of any song")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Live (default): lines roll along with the song. Full: the whole text.")
        .addChoices({ name: "Live", value: "live" }, { name: "Full", value: "full" }),
    )
    .addStringOption((o) => o.setName("song").setDescription("Look up another song instead (shows the full text)").setMaxLength(200)),

  async execute(interaction, client) {
    const query = interaction.options.getString("song");
    const current = client.lavalink.getPlayer(interaction.guildId)?.queue.current;
    if (!query && !current) {
      await respond(interaction, errorEmbed("Nothing is playing. Use `/lyrics song:<name>` to look one up."), true);
      return;
    }

    // Rolling lyrics for the current song (only this song: they end when it does).
    if (!query && interaction.options.getString("mode") !== "full") {
      const reply = await interaction.reply({ embeds: [infoEmbed("🎤 Looking up lyrics…")], withResponse: true });
      const message = reply.resource?.message;
      if (message) startLiveLyrics(client, interaction.guildId, message);
      return;
    }

    await interaction.deferReply();
    let found: LrclibTrack | null;
    try {
      found = query ? await findLyrics(query, null, null) : await findLyricsForTrack(current!);
    } catch (error) {
      logger.warn({ err: error, query }, "Lyrics lookup failed");
      await respond(interaction, errorEmbed("The lyrics service didn't respond. Try again in a moment."));
      return;
    }

    const plain = found?.plainLyrics?.trim() || (found?.syncedLyrics ? parseLrc(found.syncedLyrics).map((l) => l.text).join("\n") : "");
    if (!found || (!plain && !found.instrumental)) {
      await respond(interaction, errorEmbed(`No lyrics found for **${truncate(query ?? current!.info.title, 100)}**.`));
      return;
    }
    const text = found.instrumental ? "🎼 *Instrumental*" : plain;
    const pages: string[] = [];
    for (let i = 0; i < text.length && pages.length < 3; i += PAGE) pages.push(text.slice(i, i + PAGE));
    const embeds = pages.map((page, i) =>
      new EmbedBuilder()
        .setColor(Colors.primary)
        .setDescription(page + (i === pages.length - 1 && text.length > PAGE * 3 ? "\n…" : "")),
    );
    embeds[0]!.setTitle(truncate(`${found.trackName} — ${found.artistName}`, 250));
    embeds[embeds.length - 1]!.setFooter({ text: "Lyrics from LRCLIB" });
    await interaction.editReply({ embeds });
  },
};
