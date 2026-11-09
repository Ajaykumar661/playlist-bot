import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { activeFilter, BEST_VOLUME, mayClip } from "../music/audioQuality.js";
import { Colors, replyError } from "../utils/embeds.js";
import { escapeMd, truncate } from "../utils/format.js";
import type { Command } from "../utils/types.js";

export const quality: Command = {
  data: new SlashCommandBuilder().setName("quality").setDescription("Check what affects the sound quality right now"),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player?.queue.current) {
      await replyError(interaction, "Nothing is playing right now.");
      return;
    }

    const lines: string[] = [];
    lines.push(
      mayClip(player)
        ? `⚠️ **Volume:** ${player.volume}%. Above ${BEST_VOLUME}% loud songs can distort. Use \`/volume ${BEST_VOLUME}\`, ` +
            "and turn the bot up for yourself instead (right-click the bot → User Volume)."
        : `✅ **Volume:** ${player.volume}%`,
    );

    const filter = activeFilter(player);
    lines.push(filter ? `⚠️ **Filter:** ${filter}. \`/filter off\` to remove it.` : "✅ **Filter:** off");

    const current = player.queue.current;
    lines.push(
      `🎵 **Source:** ${escapeMd(truncate(current.info.title, 80))} from **${current.info.sourceName ?? "unknown"}**` +
        (current.info.uri ? ` ([link](${current.info.uri}))` : "") +
        ". If only this song sounds bad, `/wrong` picks a different upload.",
    );

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.primary).setTitle("🎧 Sound quality").setDescription(lines.join("\n"))],
    });
  },
};
