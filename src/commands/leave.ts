import { SlashCommandBuilder } from "discord.js";
import { replyError, replySuccess } from "../utils/embeds.js";
import { checkVoice } from "../utils/voice.js";
import type { Command } from "../utils/types.js";

export const leave: Command = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel"),
  async execute(interaction, client) {
    const ctx = await checkVoice(interaction, client);
    if (!ctx) return;
    if (ctx.player) {
      await ctx.player.destroy("LeaveCommand");
    } else {
      const me = interaction.guild.members.me;
      if (!me?.voice.channelId) {
        await replyError(interaction, "I'm not in a voice channel.");
        return;
      }
      await me.voice.disconnect();
    }
    await replySuccess(interaction, "👋 Left the voice channel.");
  },
};
