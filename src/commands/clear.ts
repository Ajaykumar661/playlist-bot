import { SlashCommandBuilder } from "discord.js";
import { replyError, replySuccess } from "../utils/embeds.js";
import { pluralize } from "../utils/format.js";
import { checkVoice } from "../utils/voice.js";
import type { Command } from "../utils/types.js";

export const clear: Command = {
  data: new SlashCommandBuilder().setName("clear").setDescription("Clear upcoming tracks (keeps the current one playing)"),
  async execute(interaction, client) {
    const ctx = await checkVoice(interaction, client, { requirePlayer: true });
    if (!ctx?.player) return;
    const count = ctx.player.queue.tracks.length;
    if (count === 0) {
      await replyError(interaction, "The queue is already empty.");
      return;
    }
    await ctx.player.queue.splice(0, count);
    await replySuccess(interaction, `🗑️ Cleared ${pluralize(count, "track")} from the queue.`);
  },
};
