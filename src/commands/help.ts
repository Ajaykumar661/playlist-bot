import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Colors } from "../utils/embeds.js";
import type { Command } from "../utils/types.js";

const GROUPS: { title: string; names: string[] }[] = [
  { title: "▶️ Play", names: ["play", "playnext", "songrequest", "search"] },
  { title: "⏯️ Playback", names: ["pause", "resume", "skip", "previous", "stop", "seek", "forward", "rewind", "replay"] },
  { title: "📜 Queue", names: ["queue", "nowplaying", "playqueue", "history", "jump", "move", "remove", "shuffle", "loop", "clear"] },
  { title: "🎛️ Sound & modes", names: ["volume", "quality", "filter", "autoplay", "247"] },
  { title: "🎵 Extras", names: ["wrong", "lyrics", "grab", "leave", "help"] },
];

export const help: Command = {
  data: new SlashCommandBuilder().setName("help").setDescription("List all commands"),
  async execute(interaction, client) {
    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle("Commands")
      .setDescription(
        "Play Apple Music, Spotify or YouTube links (playlists, albums, songs) or search text.\n" +
          "The **Now playing** message has buttons: ⏮️ ⏯️ ⏭️ ⏹️ 📜 · 🔀 🔁 ♾️ 🎤 (use `/volume` for volume)",
      );
    const listed = new Set<string>();
    for (const group of GROUPS) {
      const lines = group.names
        .map((n) => client.commands.get(n))
        .filter((c) => c !== undefined)
        .map((c) => {
          listed.add(c.data.name);
          return `\`/${c.data.name}\` ${c.data.description}`;
        });
      if (lines.length) embed.addFields({ name: group.title, value: lines.join("\n") });
    }
    const other = [...client.commands.values()].filter((c) => !listed.has(c.data.name));
    if (other.length) embed.addFields({ name: "Other", value: other.map((c) => `\`/${c.data.name}\` ${c.data.description}`).join("\n") });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
