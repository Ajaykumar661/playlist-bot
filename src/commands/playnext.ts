import { SlashCommandBuilder } from "discord.js";
import { runPlay } from "./play.js";
import type { Command } from "../utils/types.js";

export const playnext: Command = {
  data: new SlashCommandBuilder()
    .setName("playnext")
    .setDescription("Add a song, album or playlist to the front of the queue")
    .addStringOption((o) =>
      o.setName("query").setDescription("Apple Music / Spotify / YouTube link, or search text").setRequired(true).setMaxLength(500),
    ),
  execute: (interaction, client) => runPlay(interaction, client, interaction.options.getString("query", true), true),
};
