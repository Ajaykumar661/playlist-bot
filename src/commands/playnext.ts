import { SlashCommandBuilder } from "discord.js";
import { runPlay } from "./play.js";
import { suggestTracks } from "../music/suggest.js";
import type { Command } from "../utils/types.js";

export const playnext: Command = {
  data: new SlashCommandBuilder()
    .setName("playnext")
    .setDescription("Add a song, album or playlist to the front of the queue")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("Link, or type a song name and pick from the suggestions")
        .setRequired(true)
        .setMaxLength(500)
        .setAutocomplete(true),
    ),
  execute: (interaction, client) => runPlay(interaction, client, interaction.options.getString("query", true), true),
  autocomplete: suggestTracks,
};
