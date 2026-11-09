import { SlashCommandBuilder } from "discord.js";
import { buildQueueEmbed, clampPage, queueComponents } from "../music/queueView.js";
import { replyError } from "../utils/embeds.js";
import type { Command } from "../utils/types.js";

export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the queue (the 📜 button shows it inside the Now playing message)")
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
