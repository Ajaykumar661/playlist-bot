import { SlashCommandBuilder } from "discord.js";
import { adoptLiveMessage, playerView } from "../music/nowPlaying.js";
import { replyError } from "../utils/embeds.js";
import type { Command } from "../utils/types.js";

// Read-only, so anyone in the server can use it. The reply carries the control buttons and becomes the live player message.
export const nowplaying: Command = {
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the player card for the current song, with the controls"),
  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    const track = player?.queue.current;
    if (!player || !track) {
      await replyError(interaction, "Nothing is playing right now.");
      return;
    }
    const response = await interaction.reply({
      ...playerView(player, track),
      allowedMentions: { parse: [] },
      withResponse: true,
    });
    const message = response.resource?.message;
    if (message) await adoptLiveMessage(client, interaction.guildId, message.channelId, message.id);
  },
};
