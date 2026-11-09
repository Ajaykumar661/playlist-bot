import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { playFromHistory } from "../music/actions.js";
import { historyPickRow, respondWithTracks } from "../music/picker.js";
import { Colors, replyError } from "../utils/embeds.js";
import { escapeMd, formatDuration, truncate } from "../utils/format.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

const SHOWN = 25;

export const history: Command = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recently played songs, and play one again")
    .addIntegerOption((o) =>
      o
        .setName("song")
        .setDescription("Play this song again (start typing a title, or pick from the list)")
        .setMinValue(1)
        .setAutocomplete(true),
    ),

  async execute(interaction, client) {
    const pick = interaction.options.getInteger("song");
    if (pick !== null) {
      await runAction(interaction, client, (p) => playFromHistory(p, pick - 1), { quiet: true });
      return;
    }

    const player = client.lavalink.getPlayer(interaction.guildId);
    const played = player?.queue.previous ?? [];
    if (!player || played.length === 0) {
      await replyError(interaction, "Nothing has been played yet.");
      return;
    }

    const lines = played.slice(0, SHOWN).map((t, i) => {
      const title = escapeMd(truncate(t.info.title ?? "Unknown", 60));
      const author = escapeMd(truncate(t.info.author ?? "Unknown", 30));
      return `\`${String(i + 1).padStart(2, " ")}.\` ${title} — ${author} \`${formatDuration(t.info.duration ?? 0)}\``;
    });
    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle("Recently played")
      .setDescription(lines.join("\n"))
      .setFooter({ text: "1 = most recent · ⏮️ goes back one song at a time" });
    const row = historyPickRow(player);
    await interaction.reply({ embeds: [embed], components: row ? [row] : [] });
  },

  autocomplete: (interaction, client) =>
    respondWithTracks(interaction, client.lavalink.getPlayer(interaction.guildId)?.queue.previous ?? []),
};
