import { SlashCommandBuilder } from "discord.js";
import { replyError, replySuccess } from "../utils/embeds.js";
import { escapeMd, truncate } from "../utils/format.js";
import { checkVoice } from "../utils/voice.js";
import type { Command } from "../utils/types.js";

export const remove: Command = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue")
    .addIntegerOption((o) =>
      o.setName("position").setDescription("Position in /queue (1 = next up)").setRequired(true).setMinValue(1),
    ),
  async execute(interaction, client) {
    const ctx = await checkVoice(interaction, client, { requirePlayer: true });
    if (!ctx?.player) return;
    const { player } = ctx;
    const position = interaction.options.getInteger("position", true);
    const length = player.queue.tracks.length;

    if (length === 0) {
      await replyError(interaction, "The queue is empty.");
      return;
    }
    if (position > length) {
      await replyError(interaction, length === 1 ? "There is only 1 track in the queue." : `There are only ${length} tracks in the queue.`);
      return;
    }

    const result = await player.queue.remove(position - 1);
    const removed = result?.removed[0];
    await replySuccess(
      interaction,
      `Removed **${escapeMd(truncate(removed?.info.title ?? "track", 100))}** from position ${position}.`,
    );
  },
};
